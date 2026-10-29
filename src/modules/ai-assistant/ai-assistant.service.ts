import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import type { ResponseCreateParamsNonStreaming, ResponseInput } from 'openai/resources/responses/responses';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { normalizeSearch } from '../../common/utils/search-query.js';
import { BookingFlowService } from '../bookings/booking-flow.service.js';
import { BookingSlotsDto } from '../bookings/dtos/booking-slots.dto.js';
import { PackagesService } from '../specialties/packages.service.js';
import { AI_TOOLS } from './ai-tools.js';
import { INTAKE_FORMAT, INTAKE_INSTRUCTIONS, parseIntake } from './ai-intake.js';
import { AiChatMessageDto, AiAgentChatResponse } from './dtos/ai-chat.dto.js';

type State = Pick<AiAgentChatResponse, 'proposal' | 'proposedPackages' | 'doctors'>;
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

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly flow: BookingFlowService,
    private readonly packages: PackagesService,
  ) {
    const key = config.get<string>('openai.apiKey');
    this.model = config.getOrThrow<string>('openai.model');
    this.client = key ? new OpenAI({ apiKey: key, timeout: 20_000, maxRetries: 0 }) : null;
  }

  async chat(dto: AiChatMessageDto, userId?: string, ip = 'unknown'): Promise<AiAgentChatResponse> {
    if (!this.client) throw new ServiceUnavailableException('Trợ lý AI chưa được cấu hình. Vui lòng đặt lịch trực tiếp.');
    await this.rateLimit(userId || ip);
    const conversation = await this.conversation(dto.sessionId, userId);
    if (conversation.isClosed) throw new ConflictException('Phiên đã giữ chỗ. Vui lòng mở cuộc trò chuyện mới.');
    const rows = await this.prisma.aIMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' }, take: 12,
      select: { sender: true, content: true, structuredResponse: true },
    });
    const state: State = {};
    const last = rows.find(row => row.sender === 'ASSISTANT')?.structuredResponse as State | null;
    const previousProposal = last?.proposal && Date.parse(last.proposal.expiresAt) > Date.now() ? last.proposal : null;
    const message = sanitize(dto.message.trim());
    const input: ResponseInput = rows.reverse().map(row => ({
      role: row.sender === 'USER' ? 'user' as const : 'assistant' as const, content: sanitize(row.content),
    }));
    input.push({ role: 'user', content: message });
    const signal = AbortSignal.timeout(45_000);
    const assessment = await this.respond({
      instructions: INTAKE_INSTRUCTIONS, input, text: { format: INTAKE_FORMAT }, max_output_tokens: 1200,
    }, signal);
    const intake = parseIntake(assessment.output_text);
    if (intake.route === 'CLARIFY' || intake.route === 'URGENT') {
      const response: AiAgentChatResponse = {
        sessionId: conversation.id, step: 'COLLECTING_INFO', proposal: null,
        message: intake.route === 'URGENT'
          ? 'Thông tin bạn mô tả có thể cần được đánh giá khẩn cấp. Hãy liên hệ cấp cứu hoặc cơ sở y tế gần nhất; không chờ đặt lịch qua trợ lý AI.'
          : intake.message,
      };
      await this.saveTurn(conversation.id, message, response, userId, conversation.updatedAt);
      return response;
    }
    const instructions = [
      'Bạn là trợ lý đặt lịch của VitaCare, trả lời ngắn gọn bằng tiếng Việt.',
      'Chỉ hỗ trợ thông tin phòng khám, định hướng chuyên khoa và tra cứu lịch. Không chẩn đoán, kê thuốc hoặc hướng dẫn liều dùng.',
      'Nếu có dấu hiệu nguy hiểm, khuyến nghị liên hệ cấp cứu và dừng đề xuất đặt lịch.',
      'Thông tin tên cơ sở, bác sĩ, giá và lịch phải lấy từ tools. Không tự tạo ID hoặc khẳng định đã giữ chỗ.',
      'Quy định thời gian đặt lịch hiện tại: ' + this.flow.getBookingDateRange().notice,
      'Nếu ngày yêu cầu chưa được phép đặt, giải thích ngắn theo đúng thông báo backend, rồi hỏi người dùng có muốn chọn ngày sớm nhất không. Khi backend xác nhận đã qua 16h30, nói trực tiếp “Đã qua 16h30 nên không thể đặt lịch khám ngày ...”, giữ đúng ngày backend cung cấp; không dùng lý do này khi chưa qua mốc đó. Không dùng cụm “ngoài khoảng thời gian cho phép tra cứu”, “chưa thể xác nhận” hay “chưa kiểm tra được lịch”, không gọi đó là hết chỗ. Không thêm giá hoặc nội dung thanh toán trong trường hợp này. Ngày được phép đặt chưa có nghĩa là còn lịch trống; cần tools kiểm tra sau khi người dùng đồng ý. Không tự đổi ngày, buổi hoặc cơ sở.',
      'Chỉ tư vấn và tra cứu. Khi có lịch đề xuất, hướng dẫn bấm “Tiếp tục đặt lịch” để sang luồng đặt lịch chung, kiểm tra thông tin, chọn hồ sơ rồi xác nhận và thanh toán. Chat không giữ chỗ, không tạo lịch và không nhận xác nhận bằng tin nhắn. Không tự bịa chính sách hoàn tiền, bảo hiểm hoặc khuyến mãi.',
      'Dùng getClinicCatalog để xác định ID trước khi tìm. Khi gợi ý dịch vụ có thể tra cứu mọi cơ sở; chỉ cần hỏi cơ sở, hình thức và ngày giờ trước khi tìm lịch.',
      intake.route === 'READY'
        ? 'Người dùng đã mô tả đủ để định hướng khám. Dựa trên ngữ cảnh để chọn chuyên khoa thực tế từ danh mục, tìm dịch vụ phù hợp bằng tools và giải thích ngắn lý do gợi ý. Không hỏi lại triệu chứng đã có, không chẩn đoán, khẳng định an toàn hay tự chỉ định xét nghiệm. Chỉ tìm lịch sau khi người dùng chọn dịch vụ/bác sĩ.'
        : 'Người dùng đang hỏi thông tin hoặc yêu cầu dịch vụ rõ ràng. Tra cứu trực tiếp, không bắt trả lời bộ câu hỏi triệu chứng.',
      'Không có dịch vụ phù hợp thì nói rõ, không lấy gói không liên quan thay thế. Khi gợi ý, nêu đây là hỗ trợ chọn dịch vụ; bác sĩ sẽ đánh giá và quyết định chuyên môn.',
      'Dùng searchServicePackages với từ khóa ngắn, không gửi toàn bộ câu hỏi. Gói khám sức khỏe dùng trang đặt lịch thông thường.',
      'Giá và lịch trong đề xuất chỉ để tham khảo; trang đặt lịch sẽ kiểm tra lại lịch trống và tính tổng tiền. Không yêu cầu đăng nhập hoặc chọn hồ sơ trong chat.',
      'Chỉ tìm tối đa một đề xuất lịch trong mỗi lượt. Khi thiếu dữ liệu hãy hỏi, không gọi tool lặp lại vô hạn.',
      'Người dùng chọn hồ sơ ở trang đặt lịch; không hỏi CCCD, số điện thoại hay bệnh án trong chat.',
      'Hôm nay: ' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + ' (Asia/Ho_Chi_Minh).',
      'Đề xuất trước đó để tham khảo, cần tìm lại nếu muốn hiển thị thẻ mới: ' + JSON.stringify(previousProposal),
    ].join('\n');
    const tools = intake.route === 'READY' ? AI_TOOLS.filter(tool => tool.name !== 'searchAvailableSlots') : AI_TOOLS;
    let dateRejected = false;
    let answer = '';
    for (let turn = 0; turn < 4; turn++) {
      const result = await this.respond({
        instructions, input, tools,
        max_output_tokens: 1800, parallel_tool_calls: false,
        ...(turn === 3 || dateRejected ? { tool_choice: 'none' as const } : {}),
      }, signal);
      input.push(...result.output.filter(item => item.type === 'function_call' || item.type === 'message' || item.type === 'reasoning'));
      const calls = result.output.filter(item => item.type === 'function_call');
      if (!calls.length) { answer = result.output_text; break; }
      for (const call of calls.slice(0, 4)) {
        let output: unknown;
        try {
          if (dateRejected) throw new BadRequestException('Cần người dùng chọn lại ngày trước khi tiếp tục tìm lịch.');
          if (!tools.some(tool => tool.name === call.name)) throw new BadRequestException('Hãy chọn dịch vụ hoặc bác sĩ trước khi tìm lịch.');
          const args = JSON.parse(call.arguments);
          output = await this.runTool(call.name, args, state);
        } catch (error) {
          const details = error instanceof HttpException ? error.getResponse() : null;
          if (details && typeof details === 'object' && 'code' in details && details.code === 'BOOKING_DATE_OUT_OF_RANGE') {
            dateRejected = true;
            state.proposal = null;
          }
          output = { error: error instanceof HttpException ? error.message : 'Không thể tra cứu. Hãy hỏi lại thông tin cần thiết.', ...(details && typeof details === 'object' ? { details } : {}) };
        }
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
      }
    }
    const response: AiAgentChatResponse = {
      sessionId: conversation.id, message: answer || 'Bạn muốn khám chuyên khoa nào, tại cơ sở nào và vào ngày nào?',
      step: state.proposal ? 'PROPOSED' : 'COLLECTING_INFO',
      ...state,
    };
    await this.saveTurn(conversation.id, message, response, userId, conversation.updatedAt);
    return response;
  }

  private async respond(params: Omit<ResponseCreateParamsNonStreaming, 'model' | 'store'>, signal: AbortSignal) {
    const result = await this.client!.responses.create({ ...params, model: this.model, store: false }, { signal }).catch(error => {
      this.logger.warn({
        message: 'OpenAI request failed',
        stage: params.text?.format?.type === 'json_schema' ? 'intake' : 'chat',
        model: this.model,
        name: error?.name,
        status: error?.status,
        code: error?.code,
        requestId: error?.request_id,
        causeCode: error?.cause?.code || error?.cause?.cause?.code,
      });
      throw new ServiceUnavailableException('Trợ lý AI đang gián đoạn. Vui lòng thử lại hoặc liên hệ cơ sở y tế.');
    });
    if (result.status !== 'completed') throw new ServiceUnavailableException('Phản hồi AI chưa hoàn tất. Vui lòng thử lại.');
    return result;
  }

  private async runTool(name: string, args: Record<string, unknown>, state: State) {
    const value = (key: string) => typeof args[key] === 'string' && args[key] ? String(args[key]).trim().slice(0, 200) : undefined;
    if (name === 'getClinicCatalog') {
      const data = await this.flow.getBookingInit({});
      return { branches: data.branches, specialties: 'specialties' in data ? data.specialties : [], bookingMethods: data.bookingMethods };
    }
    if (name === 'searchServicePackages') {
      if (!value('query')) throw new BadRequestException('Thiếu từ khóa tìm dịch vụ.');
      const data = await this.packages.getPackages({ search: value('query'), branchId: value('branchId'), specialtyId: value('specialtyId'), limit: 6 });
      state.proposedPackages = data.data.map(pkg => ({
        id: pkg.id, code: pkg.code, name: pkg.name, price: pkg.price,
        description: pkg.description || undefined, branchId: pkg.branchId,
        specialtyId: pkg.specialtyId, bookingMethodCode: pkg.bookingMethod?.code,
      }));
      state.proposal = null;
      return state.proposedPackages;
    }
    if (name === 'searchDoctors') {
      const data = await this.flow.getBookingInit({
        flow: args.bookingMethodCode === 'ONLINE_CONSULTATION' ? 'online' : 'doctor',
        branchId: value('branchId'), specialtyId: value('specialtyId'),
      });
      const query = normalizeSearch(value('query') || '');
      const doctors = 'doctors' in data ? data.doctors : [];
      state.doctors = doctors.filter(doc => !query || normalizeSearch(doc.fullName).includes(query)).slice(0, 6).map(doc => ({
        id: doc.id, fullName: doc.fullName, title: doc.academicRank || undefined,
        specialtyName: doc.specialtyName, branchId: 'branchId' in doc ? String(doc.branchId) : value('branchId') || '',
        branchName: 'branches' in doc ? doc.branches[0]?.name || '' : data.selectedBranch?.name || '',
        consultationFee: args.bookingMethodCode === 'ONLINE_CONSULTATION' ? doc.onlineConsultationFee : doc.consultationFee,
      }));
      state.proposal = null;
      return state.doctors;
    }
    if (name !== 'searchAvailableSlots') throw new BadRequestException('Thao tác không được hỗ trợ.');
    state.proposal = null;
    const dto = plainToInstance(BookingSlotsDto, {
      bookingMethodCode: value('bookingMethodCode'), branchId: value('branchId'), specialtyId: value('specialtyId'),
      doctorId: value('doctorId'), servicePackageId: value('servicePackageId'), date: value('date'),
    });
    if (!dto.branchId || !dto.bookingMethodCode || (await validate(dto)).length) throw new BadRequestException('Chọn cơ sở, hình thức và ngày khám hợp lệ.');
    if (!isUUID(dto.branchId) || (dto.doctorId && !isUUID(dto.doctorId)) || (dto.servicePackageId && !isUUID(dto.servicePackageId))) throw new BadRequestException('Hãy tra cứu lại ID cơ sở, bác sĩ và dịch vụ từ danh mục.');
    if (!dto.doctorId && !dto.specialtyId && !dto.servicePackageId) throw new BadRequestException('Chọn chuyên khoa, bác sĩ hoặc dịch vụ trước khi tìm lịch.');
    if (!['CONSULTATION', 'ONLINE_CONSULTATION', 'SPECIALTY_EXAM', 'AFTER_HOURS'].includes(dto.bookingMethodCode)) throw new BadRequestException('Hình thức này cần tiếp tục trên trang đặt lịch.');
    if (['SPECIALTY_EXAM', 'AFTER_HOURS'].includes(dto.bookingMethodCode) && !dto.servicePackageId) throw new BadRequestException('Chọn dịch vụ khám trước khi tìm lịch.');
    if (['CONSULTATION', 'ONLINE_CONSULTATION'].includes(dto.bookingMethodCode) && dto.servicePackageId) throw new BadRequestException('Khám theo bác sĩ không kèm mã gói dịch vụ.');
    const startTime = value('startTime');
    if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw new BadRequestException('Giờ khám phải có định dạng HH:mm.');
    const data = await this.flow.getBookingSlots(dto);
    const slots = data.slots.filter(slot => !slot.isFull && (!args.period || slot.period === args.period) && (!startTime || slot.startTime === startTime));
    const slot = slots[0];
    const doctor = slot?.doctors.find(doc => doc.remainingSlots > 0 && (!dto.doctorId || doc.doctorId === dto.doctorId));
    state.proposal = null;
    if (!slot || !doctor) return { proposal: null, availableDates: data.availableDates.slice(0, 14), message: 'Không có lịch phù hợp, vui lòng chọn ngày hoặc buổi khác.' };
    const [branch, pkg] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: dto.branchId }, select: { name: true } }),
      dto.servicePackageId ? this.prisma.servicePackage.findUnique({ where: { id: dto.servicePackageId }, select: { id: true, name: true, price: true, specialtyId: true } }) : null,
    ]);
    state.proposal = {
      id: randomUUID(), expiresAt: new Date(Date.now() + TTL).toISOString(), bookingMethodCode: dto.bookingMethodCode,
      slotId: doctor.slotId, doctorId: doctor.doctorId, doctorName: doctor.doctorName,
      specialtyId: dto.specialtyId || (pkg?.specialtyId != null ? String(pkg.specialtyId) : undefined),
      specialtyName: state.doctors?.find(item => item.id === doctor.doctorId)?.specialtyName || '',
      branchId: dto.branchId, branchName: branch?.name || '', date: data.date!,
      startTime: slot.startTime, endTime: slot.endTime, servicePackageId: pkg?.id, packageName: pkg?.name,
      fee: pkg ? Number(pkg.price) : dto.bookingMethodCode === 'ONLINE_CONSULTATION' ? doctor.onlineConsultationFee : doctor.consultationFee,
    };
    return { proposal: state.proposal, availableDates: data.availableDates.slice(0, 14) };
  }

  private async conversation(id?: string, userId?: string) {
    if (!id) return this.prisma.aIConversation.create({
      data: { userId, conversationType: 'BOOKING_ASSISTANCE' }, select: { id: true, userId: true, isClosed: true, updatedAt: true },
    });
    let row = await this.prisma.aIConversation.findUnique({ where: { id }, select: { id: true, userId: true, isClosed: true, updatedAt: true } });
    if (!row) throw new NotFoundException('Không tìm thấy cuộc trò chuyện. Vui lòng mở phiên mới.');
    if (!row.userId && userId) {
      await this.prisma.aIConversation.updateMany({ where: { id, userId: null }, data: { userId } });
      row = await this.prisma.aIConversation.findUniqueOrThrow({ where: { id }, select: { id: true, userId: true, isClosed: true, updatedAt: true } });
    }
    if (row.userId !== (userId || null)) throw new ForbiddenException('Bạn không có quyền truy cập cuộc trò chuyện này.');
    return row;
  }

  private saveTurn(conversationId: string, message: string, response: AiAgentChatResponse, userId?: string, version?: Date) {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.aIConversation.updateMany({
        where: { id: conversationId, userId: userId || null, isClosed: false, ...(version ? { updatedAt: version } : {}) },
        data: { title: message.slice(0, 100), updatedAt: new Date(Math.max(Date.now(), (version?.getTime() || 0) + 1)) },
      });
      if (!changed.count) throw new ConflictException('Cuộc trò chuyện đã thay đổi. Vui lòng gửi lại tin nhắn.');
      await tx.aIMessage.createMany({ data: [
        { conversationId, sender: 'USER', content: message },
        { conversationId, sender: 'ASSISTANT', content: response.message, structuredResponse: json(response) },
      ] });
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
