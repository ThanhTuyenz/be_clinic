import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseInput,
  Response as OpenAIResponse,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { normalizeSearch, parseSearchIntent } from '../../common/utils/search-query.js';
import { CLINIC_SESSIONS } from '../../common/constants/clinic-sessions.js';
import { BookingFlowService } from '../bookings/booking-flow.service.js';
import { PackagesService } from '../catalog/packages.service.js';
import { AI_TOOLS } from './ai-tools.js';
import { INTAKE_FORMAT, INTAKE_INSTRUCTIONS, parseIntake, type IntakeDecision } from './ai-intake.js';
import { AiChatMessageDto, AiAgentChatResponse } from './dtos/ai-chat.dto.js';
import { AiPaymentStatusService } from './ai-payment-status.service.js';
import { isScheduleState, scheduleTimeLabel, type ScheduleState } from './ai-schedule-state.js';

type State = Pick<AiAgentChatResponse, 'proposal' | 'proposedPackages' | 'doctors' | 'showAppointments' | 'paymentStatus'>;
type ChatProgress = (delta: string) => void;
type ClinicCatalog = {
  branches: Array<{ id: number; code: string; name: string }>;
  specialties: Array<{ id: number; name: string }>;
  bookingMethods: Array<{ id: number; code: string; name: string }>;
};
const TTL = 15 * 60_000;
const sanitize = (text: string) => text
  .replace(/\b(?:\+84|0)\d{9,10}\b/g, '[SĐT]')
  .replace(/\b\d{9,12}\b/g, '[ĐỊNH_DANH]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly intakeModel: string;
  private readonly intakeMaxOutputTokens: number;
  private readonly chatMaxOutputTokens: number;
  private readonly intakeDurations: number[] = [];
  private catalogCache?: { value: ClinicCatalog; expiresAt: number };
  private catalogInFlight?: Promise<ClinicCatalog>;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly flow: BookingFlowService,
    private readonly packages: PackagesService,
    private readonly paymentStatuses: AiPaymentStatusService,
  ) {
    const key = config.get<string>('openai.apiKey');
    this.model = config.getOrThrow<string>('openai.model');
    this.intakeModel = config.getOrThrow<string>('openai.intakeModel');
    this.intakeMaxOutputTokens = config.getOrThrow<number>('openai.intakeMaxOutputTokens');
    this.chatMaxOutputTokens = config.getOrThrow<number>('openai.chatMaxOutputTokens');
    this.client = key ? new OpenAI({ apiKey: key, timeout: 20_000, maxRetries: 0 }) : null;
  }

  async chat(dto: AiChatMessageDto, userId?: string, ip = 'unknown', onTextDelta?: ChatProgress): Promise<AiAgentChatResponse> {
    const startedAt = Date.now();
    if (!this.client && !dto.paymentAppointmentId) throw new ServiceUnavailableException('Trợ lý AI chưa được cấu hình. Vui lòng đặt lịch trực tiếp.');
    const rateLimitStartedAt = Date.now();
    await this.rateLimit(userId || ip);
    this.logger.debug({ event: 'ai_rate_limit_checked', durationMs: Date.now() - rateLimitStartedAt });
    const conversationStartedAt = Date.now();
    const conversation = await this.conversation(dto.sessionId, userId);
    this.logger.debug({ event: 'ai_conversation_loaded', durationMs: Date.now() - conversationStartedAt });
    if (conversation.isClosed) throw new ConflictException('Phiên đã giữ chỗ. Vui lòng mở cuộc trò chuyện mới.');

    const state: State = {};
    const message = sanitize(dto.message.trim());

    if (dto.paymentAppointmentId) {
      const answer = await this.executeTool('getMyPaymentStatus', { appointmentReference: dto.paymentAppointmentId, refresh: true }, state, userId);
      const response: AiAgentChatResponse = {
        sessionId: conversation.id, step: 'COLLECTING_INFO', ...state,
        message: answer,
      };
      await this.saveTurn(conversation.id, message, response, userId, conversation.updatedAt);
      this.logger.debug({ event: 'ai_chat_completed', path: 'payment', durationMs: Date.now() - startedAt });
      return response;
    }

    const historyStartedAt = Date.now();
    // Only the latest assistant turn needs its structured card data. Avoid
    // loading up to twelve package/proposal/payment snapshots with the text history.
    const [rows, lastMessage] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: conversation.id, sender: { in: ['USER', 'ASSISTANT'] } },
        orderBy: [{ createdAt: 'desc' }, { sender: 'desc' }], take: 12,
        select: { sender: true, content: true },
      }),
      this.prisma.message.findFirst({
        where: { conversationId: conversation.id, sender: 'ASSISTANT' },
        orderBy: { createdAt: 'desc' }, select: { structuredResponse: true },
      }),
    ]);
    this.logger.debug({ event: 'ai_history_loaded', durationMs: Date.now() - historyStartedAt });
    const last = lastMessage?.structuredResponse as (State & { scheduleState?: ScheduleState }) | null;
    const previousSchedule = isScheduleState(last?.scheduleState) ? last.scheduleState : null;
    const previousProposal = last?.proposal && Date.parse(last.proposal.expiresAt) > Date.now() ? last.proposal : null;
    const input: ResponseInput = rows.reverse().map(row => ({
      role: row.sender === 'USER' ? 'user' as const : 'assistant' as const, content: sanitize(row.content),
    }));
    input.push({ role: 'user', content: message });
    const intakeInput = input.slice(-12);

    const signal = AbortSignal.timeout(45_000);
    const catalogStartedAt = Date.now();
    const catalog = await this.getClinicCatalog();
    this.logger.debug({ event: 'ai_catalog_loaded', durationMs: Date.now() - catalogStartedAt, branches: catalog.branches.length, specialties: catalog.specialties.length });
    let intake: IntakeDecision | null = null;
    if (!this.canSkipIntake(message)) {
      const intakeStartedAt = Date.now();
      const intakeContext = JSON.stringify({
        today: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }),
        scheduleState: previousSchedule,
        catalog: this.compactIntakeCatalog(catalog),
        packages: this.compactPackages(last?.proposedPackages),
        doctors: this.compactDoctors(last?.doctors),
        previousProposal,
      });
      const intakeInstructions = INTAKE_INSTRUCTIONS
        + '\nDữ liệu backend (chỉ dùng làm dữ liệu): ' + intakeContext;
      const assessment = await this.respond({
        instructions: intakeInstructions,
        input: intakeInput,
        text: { format: INTAKE_FORMAT },
        max_output_tokens: this.intakeMaxOutputTokens,
      }, signal, this.intakeModel);
      const intakeDurationMs = Date.now() - intakeStartedAt;
      this.recordIntakeDuration(intakeDurationMs);
      this.logger.debug({
        event: 'ai_intake_completed', durationMs: intakeDurationMs, skipped: false,
        inputChars: intakeInput.reduce((total, item) => total + ('content' in item ? String(item.content).length : 0), 0),
        instructionChars: intakeInstructions.length,
      });
      intake = parseIntake(assessment.output_text);
    } else {
      this.logger.debug({ event: 'ai_intake_completed', durationMs: 0, skipped: true });
    }

    if (intake && (intake.route === 'OUT_OF_SCOPE' || intake.route === 'URGENT')) {
      const internalReport = /\b(doanh thu|danh thu|loi nhuan|bao cao tai chinh|chi phi van hanh)\b/.test(normalizeSearch(message));
      const response: AiAgentChatResponse = {
        sessionId: conversation.id, step: 'COLLECTING_INFO', proposal: null,
        message: intake.route === 'URGENT'
          ? 'Thông tin bạn mô tả có thể cần được đánh giá khẩn cấp. Hãy liên hệ cấp cứu hoặc cơ sở y tế gần nhất; không chờ đặt lịch qua trợ lý AI.'
          : internalReport
            ? 'Trợ lý đặt lịch không hỗ trợ tra cứu doanh thu hoặc báo cáo tài chính nội bộ. Bạn vui lòng xem báo cáo trên trang quản trị bằng tài khoản được phân quyền. Tại đây mình có thể giúp tìm dịch vụ, bác sĩ và quản lý lịch khám.'
            : 'Yêu cầu này nằm ngoài phạm vi của trợ lý đặt lịch. Mình có thể giúp tìm dịch vụ, bác sĩ, lịch trống, thông tin phòng khám hoặc tra cứu lịch hẹn và thanh toán của bạn.',
      };
      await this.saveTurn(conversation.id, message, response, userId, conversation.updatedAt);
      this.logger.debug({ event: 'ai_chat_completed', path: intake.route.toLowerCase(), durationMs: Date.now() - startedAt });
      return response;
    }

    // Discover services after one intake call. Do not run a schedule-agent loop
    // or ask for date/doctor selection before showing the available packages.
    if (intake?.action === 'FIND_PACKAGES') {
      let branchId: number | undefined;
      let branchQuestion: string | undefined;
      if (intake.branchName) {
        const query = normalizeSearch(intake.branchName);
        const branches = catalog.branches.filter(branch => normalizeSearch(branch.name).includes(query)
          || normalizeSearch(branch.code) === query);
        if (branches.length === 1) branchId = branches[0].id;
        else branchQuestion = 'Bạn muốn xem gói khám tại cơ sở nào? '
          + catalog.branches.map(branch => branch.name).join(', ') + '.';
      }
      const schedule = intake.schedule;
      if (schedule) {
        schedule.servicePackageId = null;
        schedule.doctorId = null;
        schedule.doctorQuery = null;
        schedule.packageQuery = intake.packageQuery;
        schedule.branchId = branchId || (catalog.branches.some(branch => branch.id === schedule.branchId) ? schedule.branchId : null);
        schedule.pending = 'SERVICE';
      }
      const time = schedule && scheduleTimeLabel(schedule);
      const answer = branchQuestion || await this.executeTool('searchServicePackages', { query: intake.packageQuery, branchId: schedule?.branchId || branchId }, state, userId);
      const response: AiAgentChatResponse = {
        sessionId: conversation.id, step: 'COLLECTING_INFO', ...state, proposal: null,
        bookingPreferences: schedule ? { date: schedule.date, period: schedule.period, startTime: schedule.startTime, branchId: schedule.branchId } : undefined,
        message: time
          ? `Mình ghi nhận bạn muốn khám ${time}. ` + (branchQuestion || (state.proposedPackages?.length
            ? 'Bạn chọn “Đặt lịch” ở gói phù hợp bên dưới để tiếp tục. Chưa kiểm tra lịch trống; giờ khám cụ thể sẽ được xác định sau khi chọn dịch vụ, cơ sở và hình thức khám.'
            : answer))
          : answer,
      };
      await this.saveTurn(conversation.id, message, response, userId, conversation.updatedAt, schedule || undefined);
      this.logger.debug({ event: 'ai_chat_completed', path: 'packages', durationMs: Date.now() - startedAt });
      return response;
    }

    if (intake?.action === 'FIND_SCHEDULE' && intake.schedule) {
      const schedule = intake.schedule;
      state.proposedPackages = schedule.doctorId || schedule.doctorQuery ? undefined : last?.proposedPackages;
      state.doctors = schedule.servicePackageId || schedule.packageQuery ? undefined : last?.doctors;
      const answer = await this.findSchedule(schedule, previousSchedule || last?.proposal || null, catalog, state, userId);
      if (state.proposal) {
        state.proposedPackages = undefined;
        state.doctors = undefined;
      }
      const response: AiAgentChatResponse = {
        sessionId: conversation.id, step: state.proposal ? 'PROPOSED' : 'COLLECTING_INFO',
        ...state, message: answer,
        bookingPreferences: { date: schedule.date, period: schedule.period, startTime: schedule.startTime, branchId: schedule.branchId },
      };
      await this.saveTurn(conversation.id, message, response, userId, conversation.updatedAt, schedule);
      this.logger.debug({ event: 'ai_chat_completed', path: 'schedule', modelCalls: 1, durationMs: Date.now() - startedAt });
      return response;
    }

    const instructions = [
      'Bạn là trợ lý đặt lịch của VitaCare, trả lời ngắn gọn bằng tiếng Việt trong 2–4 câu, không lặp lại nội dung thẻ.',
      'Khi hỏi đã thanh toán/nhận tiền/hoàn tiền chưa, phải dùng getMyPaymentStatus để tra trạng thái hiện tại, không suy ra từ lịch sử hội thoại. Không biết mã lịch thì truyền null và yêu cầu chọn lịch trong danh sách. Không hỏi số tài khoản, mã giao dịch ngân hàng hay ảnh chuyển khoản. Chỉ nêu kết quả đúng label từ tool. GATEWAY_UNAVAILABLE nghĩa là chưa đồng bộ được PayOS, chỉ có trạng thái database; không khẳng định ngân hàng chưa nhận tiền. AWAITING_RECONCILIATION không phải thất bại. REFUND_REQUIRED chưa phải đã hoàn tiền. scope BOOKING_ORDER là tổng hóa đơn nhóm, không phải phí riêng một người.',
      'Khi người dùng muốn xem lịch đã đặt, hủy hoặc đổi lịch, dùng showMyAppointments để hiển thị các thẻ lịch hẹn ngay trong chat. Người dùng chọn đúng lịch và bấm xác nhận trên giao diện. Không tự nhận đã hủy/đổi lịch từ tin nhắn. Đổi lịch giữ nguyên bác sĩ, cơ sở, dịch vụ và hình thức khám, tối đa 2 lần; backend kiểm tra điều kiện thời gian. Hủy lịch đã thanh toán chỉ ghi nhận yêu cầu hoàn tiền, không hứa đã hoàn tiền hay mức hoàn tiền.',
      'Chỉ hỗ trợ tìm kiếm dịch vụ, bác sĩ, thông tin phòng khám, lịch trống, đặt/hủy/đổi lịch và thanh toán/hoàn tiền thông qua tools. Không khai thác triệu chứng, suy luận bệnh, chọn hoặc tư vấn chuyên khoa dựa trên triệu chứng, chỉ định xét nghiệm, kê thuốc hoặc hướng dẫn điều trị. Khi gặp yêu cầu ngoài phạm vi, nêu ngắn gọn phạm vi hỗ trợ, không hỏi thêm triệu chứng và không tự tìm dịch vụ thay cho tư vấn.',
      'Không có công cụ tra cứu doanh thu, lợi nhuận hoặc báo cáo tài chính nội bộ. Khi người dùng hỏi các dữ liệu này, nói rõ trợ lý đặt lịch không hỗ trợ và hướng tới trang quản trị bằng tài khoản được phân quyền; không suy đoán số liệu, không trả lời bằng thông báo về tư vấn triệu chứng.',
      'Nếu có dấu hiệu nguy hiểm, khuyến nghị liên hệ cấp cứu và dừng đề xuất đặt lịch.',
      'Thông tin tên cơ sở, bác sĩ, giá và lịch phải lấy từ tools. Không tự tạo ID hoặc khẳng định đã giữ chỗ.',
      'Quy định thời gian đặt lịch hiện tại: ' + this.flow.getBookingDateRange().notice,
      'Bạn tra cứu và đề xuất; người dùng chọn hồ sơ, kiểm tra hình thức khám và chi phí, rồi bấm nút xác nhận trong chat để hệ thống giữ chỗ và tạo mã VietQR PayOS. Không nhận xác nhận đặt lịch bằng tin nhắn, không tự khẳng định đã tạo lịch hay thanh toán. Không tự bịa chính sách hoàn tiền, bảo hiểm hoặc khuyến mãi.',
      'Danh mục cơ sở, chuyên khoa và hình thức khám: ' + JSON.stringify(this.compactCatalog(catalog)),
      'Khi người dùng hỏi địa chỉ, hotline, email, giờ mở cửa cơ sở hoặc chính sách hủy/đổi lịch, hoàn tiền, bảo hiểm, quy định đặt lịch/thanh toán, phải gọi tool getClinicInfoAndPolicies.',
      'Lượt này người dùng chưa yêu cầu tìm lịch. Chỉ trả lời yêu cầu hiện tại hoặc liệt kê gói/bác sĩ; không tìm lịch, không tự chọn dịch vụ, ngày, giờ hoặc cơ sở.',

      'Chỉ hỏi thông tin nghiệp vụ còn thiếu để tra cứu hoặc đặt lịch. Không tiếp tục câu hỏi bệnh hoặc lời tư vấn đã có trong lịch sử trò chuyện. Người dùng đặt bác sĩ tư vấn trực tuyến là yêu cầu đặt lịch, không phải yêu cầu AI tự tư vấn.',
      'Chỉ lọc dịch vụ/bác sĩ theo tên, chuyên khoa, cơ sở và điều kiện do người dùng nêu rõ. Không suy ra chuyên khoa từ triệu chứng. Không có kết quả khớp thì nói rõ, không lấy gói không liên quan thay thế.',
      'Dùng searchServicePackages với từ khóa ngắn, không gửi toàn bộ câu hỏi. Gói khám sức khỏe dùng trang đặt lịch thông thường.',
      'Giá và lịch trong đề xuất chỉ để tham khảo; thẻ xác nhận trong chat sẽ kiểm tra lại và tính tổng tiền. Tra cứu không cần đăng nhập; khi đặt lịch người dùng cần đăng nhập và chọn hồ sơ trên giao diện.',
      'Người dùng chọn hồ sơ trên giao diện; không hỏi CCCD, số điện thoại hay bệnh án trong chat.',
      'Hôm nay: ' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + ' (Asia/Ho_Chi_Minh).',
      'Đề xuất trước đó chỉ để tham khảo, không bảo đảm còn chỗ: ' + JSON.stringify(previousProposal),
      'Các gói và bác sĩ đã hiển thị ở lượt trước, chỉ dùng khi khách chọn rõ: '
        + JSON.stringify({ packages: this.compactPackages(last?.proposedPackages), doctors: this.compactDoctors(last?.doctors) }),
    ].join('\n');

    let answer = '';
    for (let turn = 0; turn < 4; turn++) {
      const turnStartedAt = Date.now();
      const result = await this.respond({
        instructions,
        input, tools: AI_TOOLS,
        max_output_tokens: this.chatMaxOutputTokens,
        parallel_tool_calls: false,
        ...(turn === 3
          ? { tool_choice: 'none' as const }
          : {}),
      }, signal, this.model, onTextDelta);

      input.push(...result.output.filter(item => item.type === 'function_call' || item.type === 'message' || item.type === 'reasoning'));
      const calls = result.output.filter(item => item.type === 'function_call');
      this.logger.debug({ event: 'ai_chat_turn', turn, durationMs: Date.now() - turnStartedAt, toolCalls: calls.map(c => c.name) });

      if (!calls.length) { answer = result.output_text; break; } // dừng khi không còn tool call


      // parallel_tool_calls=false; every successful handler returns its final text.
      const call = calls[0];
      try {
        answer = await this.executeTool(call.name, JSON.parse(call.arguments), state, userId, message);
        break;
      } catch (error) {
        const details = error instanceof HttpException ? error.getResponse() : null;
        const output = { error: error instanceof HttpException ? error.message : 'Không thể tra cứu. Hãy hỏi lại thông tin cần thiết.', ...(details && typeof details === 'object' ? { details } : {}) };
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
      }
    }
    const response: AiAgentChatResponse = {
      sessionId: conversation.id, message: answer || 'Bạn có thể tìm gói khám, bác sĩ, lịch trống hoặc xem các lịch đã đặt tại VitaCare.',
      step: 'COLLECTING_INFO',
      ...state,
    };
    const saveStartedAt = Date.now();
    await this.saveTurn(conversation.id, message, response, userId, conversation.updatedAt, previousSchedule || undefined);
    this.logger.debug({ event: 'ai_turn_saved', durationMs: Date.now() - saveStartedAt });
    this.logger.debug({ event: 'ai_chat_completed', path: 'information', durationMs: Date.now() - startedAt });
    return response;
  }

  private async findSchedule(schedule: ScheduleState, previous: { servicePackageId?: number | null; doctorId?: string | null } | null, catalog: ClinicCatalog, state: State, userId?: string): Promise<string> {
    delete schedule.pending;
    const ask = (pending: ScheduleState['pending'], message: string) => {
      schedule.pending = pending;
      state.proposal = null;
      const time = scheduleTimeLabel(schedule);
      return time ? `Thời gian bạn yêu cầu: ${time}. ${message}` : message;
    };
    // Model output may only reference IDs already supplied by the backend.
    if (schedule.branchId && !catalog.branches.some(branch => branch.id === schedule.branchId)) {
      schedule.branchId = null;
    }
    if (schedule.servicePackageId && schedule.servicePackageId !== previous?.servicePackageId
      && !state.proposedPackages?.some(pkg => pkg.id === schedule.servicePackageId)) {
      schedule.servicePackageId = null;
      return ask('SERVICE', 'Bạn hãy chọn dịch vụ trong danh sách hoặc cho biết tên dịch vụ muốn khám.');
    }
    if (schedule.doctorId && schedule.doctorId !== previous?.doctorId
      && !state.doctors?.some(doctor => doctor.id === schedule.doctorId)) {
      schedule.doctorId = null;
      return ask('SERVICE', 'Bạn hãy chọn bác sĩ trong danh sách hoặc cho biết tên bác sĩ muốn khám.');
    }

    if (!schedule.servicePackageId && !schedule.doctorId) {
      if (schedule.packageQuery) {
        await this.executeTool('searchServicePackages', {
          query: schedule.packageQuery, branchId: schedule.branchId,
        }, state, userId);
        const query = normalizeSearch(schedule.packageQuery);
        const exact = state.proposedPackages?.filter(pkg => normalizeSearch(pkg.name) === query
          || pkg.code.toLowerCase() === schedule.packageQuery!.trim().toLowerCase()) || [];
        // A single search hit is not necessarily the service the user selected.
        if (exact.length === 1) schedule.servicePackageId = exact[0].id;
        else return ask('SERVICE', state.proposedPackages?.length
          ? 'Bạn muốn tìm lịch cho dịch vụ nào trong các gói dưới đây?'
          : 'Chưa tìm thấy dịch vụ bạn yêu cầu. Bạn muốn tìm theo tên dịch vụ nào?');
      } else if (schedule.doctorQuery) {
        await this.executeTool('searchDoctors', {
          query: schedule.doctorQuery, branchId: schedule.branchId,
          bookingMethodCode: schedule.bookingMethodCode,
        }, state, userId);
        const query = normalizeSearch(schedule.doctorQuery);
        const exact = state.doctors?.filter(doctor => normalizeSearch(doctor.fullName) === query) || [];
        if (exact.length === 1) schedule.doctorId = exact[0].id;
        else return ask('SERVICE', state.doctors?.length
          ? 'Bạn muốn tìm lịch cho bác sĩ nào trong danh sách dưới đây?'
          : 'Chưa tìm thấy bác sĩ bạn yêu cầu. Bạn cho biết tên bác sĩ muốn khám nhé.');
      } else {
        return ask('SERVICE', 'Bạn muốn tìm lịch cho dịch vụ hoặc bác sĩ nào?');
      }
    }
    if (schedule.servicePackageId) schedule.packageQuery = null;
    if (schedule.doctorId) schedule.doctorQuery = null;
    if (!schedule.branchId) return ask('BRANCH', 'Bạn muốn khám tại cơ sở nào? '
      + catalog.branches.map(branch => branch.name).join(', ') + '.');
    const packageMethod = schedule.servicePackageId
      ? state.proposedPackages?.find(pkg => pkg.id === schedule.servicePackageId)?.bookingMethodCode : undefined;
    if (packageMethod === 'HEALTH_PACKAGE') return ask('SERVICE', 'Gói khám sức khỏe này cần tiếp tục trên trang đặt lịch. Bạn bấm “Đặt lịch” trên thẻ gói để chọn thời gian nhé.');
    const doctorMethod = schedule.bookingMethodCode === 'CONSULTATION' || schedule.bookingMethodCode === 'ONLINE_CONSULTATION';
    if (!schedule.bookingMethodCode || (schedule.servicePackageId && doctorMethod) || (schedule.doctorId && !doctorMethod)) {
      schedule.bookingMethodCode = null;
      return ask('METHOD', schedule.doctorId
        ? 'Bạn muốn khám trực tiếp theo bác sĩ hay khám trực tuyến?'
        : 'Bạn muốn khám chuyên khoa trong giờ hay khám ngoài giờ?');
    }
    if (!schedule.date && !schedule.earliestDate) return ask('DATE', 'Bạn muốn khám ngày nào, hay tìm ngày còn lịch sớm nhất?');

    const startedAt = Date.now();
    try {
      await this.searchAvailableSlots(schedule, state);
      if (state.proposal) return 'Mình đã tìm thấy lịch khám dưới đây. Lịch chưa được giữ chỗ; bạn kiểm tra thông tin và xác nhận trên thẻ nếu phù hợp.';
      return ask('DATE', 'Không có lịch phù hợp với yêu cầu đã chọn. Bạn muốn đổi ngày hoặc buổi khám nào?');
    } catch (error) {
      if (!(error instanceof BadRequestException) && !(error instanceof NotFoundException)) throw error;
      const details = error.getResponse();
      if (details && typeof details === 'object' && 'code' in details && details.code === 'BOOKING_DATE_OUT_OF_RANGE') {
        // Keep the rejected date until the user explicitly chooses another one.
        return ask('DATE', error.message + ' Bạn muốn chọn ngày khác hay tìm ngày còn lịch sớm nhất?');
      }
      return ask('SERVICE', error.message);
    } finally {
      this.logger.debug({ event: 'ai_tool_completed', tool: 'searchAvailableSlots', durationMs: Date.now() - startedAt });
    }
  }

  private async respond(
    params: Omit<ResponseCreateParamsNonStreaming, 'model' | 'store'>,
    signal: AbortSignal,
    model = this.model,
    onTextDelta?: ChatProgress,
  ) {
    const startedAt = Date.now();
    const stage = params.text?.format?.type === 'json_schema' ? 'intake' : 'chat';
    // Explicit effort keeps Luna from falling back to medium on either stage.
    const reasoning = /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
      ? { effort: stage === 'intake' ? 'none' as const : 'low' as const } : undefined;
    const request = { ...params, ...(reasoning ? { reasoning } : {}), model, store: false };
    const result = onTextDelta && stage === 'chat'
      ? await this.streamResponse(request, signal, onTextDelta)
      : await this.client!.responses.create(request, { signal });
    const normalized = await Promise.resolve(result as OpenAIResponse).catch(error => {
      this.logger.warn({
        message: 'OpenAI request failed',
        stage,
        model,
        name: error?.name,
        status: error?.status,
        code: error?.code,
        requestId: error?.request_id,
        causeCode: error?.cause?.code || error?.cause?.cause?.code,
      });
      throw new ServiceUnavailableException('Trợ lý AI đang gián đoạn. Vui lòng thử lại hoặc liên hệ cơ sở y tế.');
    });
    if (normalized.status !== 'completed') {
      this.logger.warn({ event: 'ai_model_incomplete', stage, model,
        status: normalized.status, reason: normalized.incomplete_details?.reason,
        maxOutputTokens: params.max_output_tokens, outputTokens: normalized.usage?.output_tokens,
        reasoningTokens: normalized.usage?.output_tokens_details?.reasoning_tokens });
      throw new ServiceUnavailableException('Phản hồi AI chưa hoàn tất. Vui lòng thử lại.');
    }
    this.logger.debug({ event: 'ai_model_completed', stage,
      model, durationMs: Date.now() - startedAt, maxOutputTokens: params.max_output_tokens,
      reasoningEffort: reasoning?.effort,
      inputTokens: normalized.usage?.input_tokens, outputTokens: normalized.usage?.output_tokens,
      cachedInputTokens: normalized.usage?.input_tokens_details?.cached_tokens,
      reasoningTokens: normalized.usage?.output_tokens_details?.reasoning_tokens,
      streamed: Boolean(onTextDelta && stage === 'chat') });
    return normalized;
  }

  private async streamResponse(
    request: object,
    signal: AbortSignal,
    onTextDelta: ChatProgress,
  ): Promise<OpenAIResponse> {
    const stream = await this.client!.responses.create({
      ...request,
      stream: true,
    } as ResponseCreateParamsStreaming, { signal });
    let completedResponse: OpenAIResponse | undefined;
    for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
      if (event.type === 'response.output_text.delta') onTextDelta(event.delta);
      if (event.type === 'response.completed') completedResponse = event.response;
    }
    if (!completedResponse) throw new ServiceUnavailableException('Phản hồi AI chưa hoàn tất. Vui lòng thử lại.');
    return completedResponse;
  }

  private canSkipIntake(message: string): boolean {
    return /^(xin chào|chào|hello|hi|alo|cảm ơn|cam on|ok|được rồi|duoc roi)[!.?\s]*$/iu.test(message)
      || /\b(xem|kiểm tra|kiem tra|tra cứu|tra cuu)\b.*\b(lịch đã đặt|lịch hẹn|thanh toán|hoàn tiền)\b/iu.test(message);
  }

  private compactCatalog(catalog: ClinicCatalog): ClinicCatalog {
    return {
      branches: catalog.branches.slice(0, 20),
      specialties: catalog.specialties.slice(0, 30),
      bookingMethods: catalog.bookingMethods.slice(0, 10),
    };
  }

  private compactIntakeCatalog(catalog: ClinicCatalog) {
    return {
      branches: catalog.branches.map(({ code, name }) => ({ code, name })),
      specialties: catalog.specialties.map(({ name }) => name),
      bookingMethods: catalog.bookingMethods.map(({ code, name }) => ({ code, name })),
    };
  }

  private compactPackages(packages: State['proposedPackages']) {
    return packages?.slice(0, 4).map(({ id, code, name, price, branchId, bookingMethodCode }) =>
      ({ id, code, name, price, branchId, bookingMethodCode }));
  }

  private compactDoctors(doctors: State['doctors']) {
    return doctors?.slice(0, 4).map(({ id, fullName, specialtyName, branchId, bookingMethodCode }) =>
      ({ id, fullName, specialtyName, branchId, bookingMethodCode }));
  }

  private recordIntakeDuration(durationMs: number) {
    this.intakeDurations.push(durationMs);
    if (this.intakeDurations.length > 100) this.intakeDurations.shift();
    const sorted = [...this.intakeDurations].sort((a, b) => a - b);
    const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    this.logger.debug({
      event: 'ai_intake_latency',
      samples: sorted.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
    });
  }

  private async getClinicCatalog(): Promise<ClinicCatalog> {
    if (this.catalogCache && this.catalogCache.expiresAt > Date.now()) return this.catalogCache.value;
    if (this.catalogInFlight) return this.catalogInFlight;
    const request = this.loadClinicCatalog().finally(() => { this.catalogInFlight = undefined; });
    this.catalogInFlight = request;
    return request;
  }

  private async loadClinicCatalog(): Promise<ClinicCatalog> {
    const cacheKey = 'ai:clinic-catalog:v1';
    if (this.redis.isEnabled()) {
      const cached = await this.redis.get<ClinicCatalog>(cacheKey).catch(() => null);
      if (cached) {
        // Respect the remaining Redis TTL instead of extending stale metadata.
        const ttl = await this.redis.getTtl(cacheKey).catch(() => 0);
        if (ttl > 0) this.catalogCache = { value: cached, expiresAt: Date.now() + Math.min(ttl, 60) * 1000 };
        return cached;
      }
    }
    // A catalog lookup needs IDs and labels, not the booking-init package and schedule payloads.
    const [branches, specialties, bookingMethods] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true, bookingMethods: { some: { isEnabled: true, bookingMethod: { isActive: true } } } },
        select: { id: true, code: true, name: true }, orderBy: { name: 'asc' },
      }),
      this.prisma.specialty.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.bookingMethod.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } }),
    ]);
    const catalog = { branches, specialties, bookingMethods };
    this.catalogCache = { value: catalog, expiresAt: Date.now() + 60_000 };
    if (this.redis.isEnabled()) await this.redis.set(cacheKey, catalog, 60).catch(() => {});
    return catalog;
  }

  private async executeTool(name: string, args: Record<string, unknown>, state: State, userId?: string, requestText?: string): Promise<string> {
    const startedAt = Date.now();
    try {
      if (name === 'getMyPaymentStatus') {
        state.paymentStatus = undefined;
        if (!userId || !args.appointmentReference) {
          state.showAppointments = true;
          return 'Bạn có thể xem trạng thái thanh toán trên các thẻ lịch khám dưới đây. Đăng nhập nếu bạn chưa đăng nhập.';
        }
        if (typeof args.appointmentReference !== 'string' || (args.refresh !== true && args.refresh !== false)) throw new BadRequestException('Yêu cầu tra cứu thanh toán không hợp lệ.');
        state.paymentStatus = await this.paymentStatuses.lookup(userId, args.appointmentReference, args.refresh);
        state.showAppointments = false;
        const payment = state.paymentStatus;
        return `Lịch hẹn ${payment.bookingCode || payment.appointmentId}: ${payment.label}.`
          + (payment.freshness === 'GATEWAY_UNAVAILABLE' ? ' Chưa đồng bộ được với PayOS; đây là trạng thái hệ thống đang ghi nhận.' : '');
      }


      if (name === 'showMyAppointments') {
        state.showAppointments = true;
        return 'Dưới đây là các lịch khám của bạn. Bạn có thể xem chi tiết, đổi hoặc hủy lịch ngay trên thẻ.';
      }

      const value = (key: string) => typeof args[key] === 'string' && args[key] ? String(args[key]).trim().slice(0, 200) : undefined;

      if (name === 'searchServicePackages') {
        state.doctors = [];
        const query = value('query');
        if (!query) throw new BadRequestException('Thiếu từ khóa tìm dịch vụ.');
        const catalog = await this.getClinicCatalog();
        let specialtyId = value('specialtyId');
        if (!specialtyId) {
          // Match full catalog labels, preserving accents: "mất ngủ" is not "mắt".
          // The shared parser has already removed exclusions and budget/age modifiers.
          const text = ` ${parseSearchIntent(query).text.normalize('NFC').toLowerCase()} `;
          const matches = catalog.specialties.filter(specialty =>
            text.includes(` ${specialty.name.normalize('NFC').toLowerCase().trim()} `));
          if (matches.length === 1) specialtyId = String(matches[0].id);
        }
        const data = await this.packages.getPackages({
          search: query, branchId: value('branchId') ? Number(value('branchId')) : undefined, specialtyId, limit: 6, searchMode: 'lexical',
        });
        state.proposedPackages = data.data.map(pkg => {
          const branchIds = new Set(pkg.bookingMethods?.map(method => method.branchId) || []);
          if (pkg.branchId) branchIds.add(pkg.branchId);
          return {
            id: pkg.id, code: pkg.code, name: pkg.name, price: pkg.price,
            description: pkg.description || undefined, branchId: pkg.branchId,
            specialtyId: pkg.specialtyId, bookingMethodCode: pkg.bookingMethod?.code,
            branches: catalog.branches.filter(branch => branchIds.has(branch.id)).map(branch => ({
              id: branch.id, name: branch.name,
              receptionHours: CLINIC_SESSIONS.flatMap(session => {
                const days = [...new Set<number>(pkg.receptionSchedules
                  .filter(day => day.branchId === branch.id && day.sessions.includes(session.code))
                  .map(day => day.dayOfWeek))].sort((a, b) => (a + 6) % 7 - (b + 6) % 7);
                return days.length ? [{ days, startTime: session.start, endTime: session.end }] : [];
              }),
            })),
          };
        });
        state.proposal = null;
        return state.proposedPackages.length
          ? 'Dưới đây là các gói khám khớp yêu cầu tìm kiếm. Bấm “Đặt lịch” để chọn hồ sơ, ngày và giờ khám.'
          : 'Chưa tìm thấy gói khám khớp yêu cầu. Bạn có thể tìm bằng tên dịch vụ hoặc cơ sở.';
      }

      if (name === 'searchDoctors') {
        state.proposedPackages = [];
        state.doctors = [];
        state.proposal = null;
        const catalog = await this.getClinicCatalog();
        // Preserve accents and word boundaries: "mất ngủ" must never match "Mắt".
        const words = (text: string) => ` ${text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
        const stated = catalog.specialties.filter(specialty => words(requestText || '').includes(words(specialty.name)));
        const specialtyValue = value('specialtyId');
        const specialtyName = value('specialtyName');
        const byArgument = catalog.specialties.filter(specialty => specialtyValue === String(specialty.id)
          || words(specialtyValue || '') === words(specialty.name)
          || words(specialtyName || '') === words(specialty.name));
        const byQuery = catalog.specialties.filter(specialty => words(value('query') || '').includes(words(specialty.name)));
        // Explicit wording wins over a missing or incorrect model-generated ID.
        const requested = stated.length ? stated : byArgument.length ? byArgument : byQuery;
        if (!requested.length && (specialtyValue || specialtyName || /chuyên\s*khoa|\bkhoa\s/iu.test(requestText || ''))) {
          return 'Chưa xác định được chuyên khoa bạn yêu cầu trong danh mục. Bạn có thể tìm bằng tên chuyên khoa cụ thể; mình sẽ không thay bằng bác sĩ khoa khác.';
        }
        const specialtyIds = new Set(requested.map(specialty => specialty.id));
        const bookingMethodCode = args.bookingMethodCode === 'ONLINE_CONSULTATION' ? 'ONLINE_CONSULTATION' as const : 'CONSULTATION' as const;
        const data = await this.flow.getBookingInit({
          flow: bookingMethodCode === 'ONLINE_CONSULTATION' ? 'online' : 'doctor',
          branchId: value('branchId'), specialtyId: requested.length === 1 ? String(requested[0].id) : undefined,
        });
        let query = normalizeSearch(value('query') || '');
        if (byQuery.length) {
          for (const specialty of byQuery) query = ` ${query} `.replace(` ${normalizeSearch(specialty.name)} `, ' ').trim();
          query = query.replace(/\b(goi y|cho toi|cho minh|mot so|1 so|bac si|chuyen khoa|khoa|tim kiem|tim|kham|giup|ve|nao|gioi)\b/g, ' ').replace(/\s+/g, ' ').trim();
        }
        const doctors = 'doctors' in data ? data.doctors : [];
        state.doctors = doctors.filter(doc => (!specialtyIds.size || doc.specialties.some(specialty => specialtyIds.has(specialty.id)))
          && (!query || normalizeSearch(doc.fullName).includes(query))).slice(0, 6).map(doc => ({
          id: doc.id, fullName: doc.fullName, title: doc.academicRank || undefined,
          avatarUrl: doc.avatarUrl || null,
          specialtyName: specialtyIds.size ? doc.specialties.filter(specialty => specialtyIds.has(specialty.id)).map(specialty => specialty.name).join(', ') : doc.specialtyName,
          branchId: 'branchId' in doc && typeof doc.branchId === 'number' ? doc.branchId : Number(value('branchId')) || undefined,
          branchName: 'branches' in doc ? doc.branches[0]?.name || '' : data.selectedBranch?.name || '',
          consultationFee: bookingMethodCode === 'ONLINE_CONSULTATION' ? doc.onlineConsultationFee : doc.consultationFee,
          bookingMethodCode,
        }));
        return state.doctors.length
          ? `Dưới đây là các bác sĩ${requested.length ? ' chuyên khoa ' + requested.map(specialty => specialty.name).join(', ') : ''} khớp yêu cầu tìm kiếm.`
          : requested.length ? `Chưa tìm thấy bác sĩ chuyên khoa ${requested.map(specialty => specialty.name).join(', ')} đáp ứng các điều kiện bạn chọn. Bạn có thể đổi cơ sở hoặc hình thức khám.`
            : 'Chưa tìm thấy bác sĩ khớp yêu cầu. Bạn có thể tìm theo tên, chuyên khoa hoặc cơ sở.';
      }

      if (name === 'getClinicInfoAndPolicies') {
        const topic = typeof args.topic === 'string' ? args.topic : 'ALL';
        return this.getClinicInfoAndPolicies(value('branchName'), topic);
      }

      throw new BadRequestException('Thao tác không được hỗ trợ.');
    } finally {
      this.logger.debug({ event: 'ai_tool_completed', tool: name, durationMs: Date.now() - startedAt });
    }
  }

  private async getClinicInfoAndPolicies(branchName?: string, topic = 'ALL'): Promise<string> {
    const sections: string[] = [];
    if (topic === 'BRANCHES' || topic === 'ALL' || branchName) {
      const branches = await this.prisma.branch.findMany({
        where: { isActive: true },
        select: { name: true, code: true, address: true, ward: true, district: true, province: true, phoneNumber: true, email: true, operatingHours: true, openTime: true, closeTime: true },
        orderBy: { name: 'asc' },
      });
      const query = normalizeSearch(branchName || '');
      const matched = query ? branches.filter(b => normalizeSearch(b.name).includes(query) || normalizeSearch(b.code) === query) : branches;
      const list = matched.length ? matched : branches;
      const branchLines = list.map(branch => {
        const address = [branch.address, branch.ward, branch.district, branch.province]
          .filter((part): part is string => Boolean(part?.trim()))
          .join(', ');
        const hours = branch.operatingHours || (branch.openTime && branch.closeTime ? `${branch.openTime}–${branch.closeTime}` : 'Sáng 07:30–11:30 · Chiều 13:30–17:00 · Tối 17:00–20:30');
        const details = [
          address ? `Địa chỉ: ${address}` : null,
          branch.phoneNumber ? `Hotline: ${branch.phoneNumber}` : null,
          branch.email ? `Email: ${branch.email}` : null,
          `Giờ mở cửa: ${hours}`,
        ].filter(Boolean);
        return `- **${branch.name}**: ${details.join(' · ')}`;
      });
      if (branchLines.length) {
        const prefix = query && !matched.length ? `Chưa tìm thấy cơ sở khớp "${branchName}". Thông tin các cơ sở hiện có:\n` : '**Thông tin cơ sở VitaCare:**\n';
        sections.push(prefix + branchLines.join('\n'));
      }
    }

    if (topic === 'REFUND_CANCEL' || topic === 'ALL') {
      sections.push(
        '**Chính sách đổi/hủy lịch & hoàn tiền:**\n'
        + '- Đổi lịch giữ nguyên bác sĩ, cơ sở, dịch vụ và hình thức khám, tối đa **2 lần** (hệ thống kiểm tra điều kiện thời gian khi xác nhận).\n'
        + '- Bệnh nhân hủy trước giờ khám từ 24 giờ được tự duyệt hoàn 95%; từ 2 đến dưới 24 giờ được tự duyệt hoàn 80% khoản thực trả sau giảm giá của lịch bị hủy. Dưới 2 giờ hoặc thiếu dữ liệu tính tiền: không hoàn tiền, không xét duyệt thủ công.\n'
        + '- Khi hủy lịch, bệnh nhân phải chọn lý do trong danh sách có sẵn trên giao diện, không nhập lý do tự do.\n'
        + '- Số tiền cụ thể được hiển thị trong hộp thoại trước khi xác nhận hủy. Tự duyệt khoản hoàn chưa có nghĩa là đã chuyển tiền; nhân viên sẽ thực hiện hoàn tiền sau đó.\n'
        + '- Để thao tác hoặc theo dõi trạng thái hoàn tiền, bạn mở danh sách lịch hẹn trong chat hoặc tra cứu trạng thái thanh toán.',
      );
    }

    if (topic === 'INSURANCE' || topic === 'ALL') {
      sections.push(
        '**Chính sách bảo hiểm:**\n'
        + '- Hệ thống đặt lịch trực tuyến hiện thanh toán trực tiếp qua VietQR PayOS và chưa hỗ trợ giảm trừ bảo hiểm tự động online.\n'
        + '- Bạn vui lòng mang theo thẻ BHYT hoặc giấy tờ bảo hiểm khi đến khám để lễ tân cơ sở kiểm tra và hướng dẫn áp dụng (nếu dịch vụ hỗ trợ).',
      );
    }

    if (topic === 'PAYMENT_BOOKING' || topic === 'ALL') {
      sections.push(
        '**Quy định đặt lịch & thanh toán:**\n'
        + `- ${this.flow.getBookingDateRange().notice}\n`
        + '- Sau khi xác nhận trên thẻ đề xuất, hệ thống giữ chỗ và tạo mã **VietQR PayOS**; bạn có thể bấm **Kiểm tra lại** trong chat để đối soát thanh toán.',
      );
    }

    return sections.join('\n\n') || 'Hiện chưa có thông tin phù hợp. Bạn có thể liên hệ trực tiếp cơ sở VitaCare để được hỗ trợ.';
  }

  // Called only after parseIntake validates the shape and findSchedule resolves
  // trusted IDs, method compatibility and the user's date choice.
  private async searchAvailableSlots(schedule: ScheduleState, state: State) {
    state.proposal = null;
    const dto = { branchId: schedule.branchId, bookingMethodCode: schedule.bookingMethodCode,
      doctorId: schedule.doctorId || undefined, servicePackageId: schedule.servicePackageId || undefined,
      date: schedule.date || undefined };
    const data = await this.flow.getBookingSlots(dto);
    const slot = data.slots.find(slot => !slot.isFull && (!schedule.period || slot.period === schedule.period)
      && (!schedule.startTime || slot.startTime === schedule.startTime));
    const doctor = slot?.doctors.find(doc => doc.remainingSlots > 0 && (!dto.doctorId || doc.doctorId === dto.doctorId));
    if (!slot || !doctor) return;
    const [branch, pkg] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: dto.branchId }, select: { name: true } }),
      dto.servicePackageId ? this.prisma.servicePackage.findUnique({ where: { id: dto.servicePackageId }, select: { id: true, name: true, price: true, specialtyId: true } }) : null,
    ]);
    state.proposal = {
      id: randomUUID(), expiresAt: new Date(Date.now() + TTL).toISOString(), bookingMethodCode: dto.bookingMethodCode,
      slotId: doctor.slotId, doctorId: doctor.doctorId, doctorName: doctor.doctorName,
      specialtyId: pkg?.specialtyId ?? undefined,
      specialtyName: state.doctors?.find(item => item.id === doctor.doctorId)?.specialtyName || '',
      branchId: dto.branchId, branchName: branch?.name || '', date: data.date!,
      startTime: slot.startTime, endTime: slot.endTime, servicePackageId: pkg?.id, packageName: pkg?.name,
      fee: pkg ? Number(pkg.price) : dto.bookingMethodCode === 'ONLINE_CONSULTATION' ? doctor.onlineConsultationFee : doctor.consultationFee,
    };
  }

  private async conversation(id?: string, userId?: string) {
    if (!id) return this.prisma.conversation.create({
      data: { userId, conversationType: 'BOOKING_ASSISTANCE' }, select: { id: true, userId: true, isClosed: true, updatedAt: true },
    });
    let row = await this.prisma.conversation.findUnique({ where: { id }, select: { id: true, userId: true, isClosed: true, updatedAt: true } });
    if (!row) throw new NotFoundException('Không tìm thấy cuộc trò chuyện. Vui lòng mở phiên mới.');
    if (!row.userId && userId) {
      await this.prisma.conversation.updateMany({ where: { id, userId: null }, data: { userId } });
      row = await this.prisma.conversation.findUniqueOrThrow({ where: { id }, select: { id: true, userId: true, isClosed: true, updatedAt: true } });
    }
    if (row.userId !== (userId || null)) throw new ForbiddenException('Bạn không có quyền truy cập cuộc trò chuyện này.');
    return row;
  }

  private saveTurn(conversationId: string, message: string, response: AiAgentChatResponse, userId?: string, version?: Date, scheduleState?: ScheduleState) {
    return this.prisma.$transaction(async tx => {
      const userAt = new Date(Math.max(Date.now(), (version?.getTime() || 0) + 1));
      const assistantAt = new Date(userAt.getTime() + 1);
      const changed = await tx.conversation.updateMany({
        where: { id: conversationId, userId: userId || null, isClosed: false, ...(version ? { updatedAt: version } : {}) },
        data: { title: message.slice(0, 100), updatedAt: assistantAt },
      });
      if (!changed.count) throw new ConflictException('Cuộc trò chuyện đã thay đổi. Vui lòng gửi lại tin nhắn.');
      await tx.message.createMany({
        data: [
          { conversationId, sender: 'USER', content: message, createdAt: userAt },
          { conversationId, sender: 'ASSISTANT', content: response.message, structuredResponse: json({ ...response, ...(scheduleState ? { scheduleState } : {}) }), createdAt: assistantAt },
        ]
      });
    });
  }

  private async rateLimit(identity: string) {
    const client = this.redis.getClient();
    if (!client) return;
    const key = 'ai:rate:' + createHash('sha256').update(identity).digest('hex');
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, 60);
    if (count > 20) throw new HttpException('Bạn gửi tin nhắn quá nhanh. Vui lòng thử lại sau.', 429);
  }
}
