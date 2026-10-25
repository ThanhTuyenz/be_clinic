import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import type { Response } from 'express'
import { GoogleGenAI, Type } from '@google/genai'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { BookingService } from '../bookings/booking.service.js'
import {
  AiChatMessageDto,
  AiChatResponsePayload,
  StructuredAiTriageResponse,
  DoctorCardRecommendation,
  PackageCardRecommendation,
  SpecialtyRecommendation,
  AiAgentChatDto,
  AiAgentChatResponse,
  AiAgentBookingProposal,
} from './dtos/ai-chat.dto.js'

export interface AgentSessionMemory {
  history: Array<{ role: 'user' | 'model'; parts: any[] }>
  lastProposal?: AiAgentBookingProposal | null
  lastPackages?: PackageCardRecommendation[]
  updatedAt: number
}

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name)
  private aiClient: GoogleGenAI | null = null
  private modelName: string = 'gemini-2.5-flash'
  private readonly agentSessionMemories = new Map<string, AgentSessionMemory>()
  private cachedSpecialties: Array<{ id: number; name: string; slug: string | null; description?: string | null }> | null = null
  private cachedBranches: Array<{ id: string; name: string; address?: string | null; phoneNumber?: string | null }> | null = null
  private lastCacheTime = 0
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 phút

  private async getCachedClinicData() {
    const now = Date.now()
    if (!this.cachedSpecialties || !this.cachedBranches || now - this.lastCacheTime > this.CACHE_TTL) {
      const [specialties, branches] = await Promise.all([
        this.prisma.specialty.findMany({
          where: { isActive: true },
          select: { id: true, name: true, slug: true, description: true },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.branch.findMany({
          where: { isActive: true },
          select: { id: true, name: true, address: true, phoneNumber: true },
        }),
      ])
      this.cachedSpecialties = specialties
      this.cachedBranches = branches
      this.lastCacheTime = now
    }
    return { specialties: this.cachedSpecialties, branches: this.cachedBranches }
  }

  private getBookingLeadTimePolicy() {
    const nowUtc = new Date()
    const vnOffsetMs = 7 * 60 * 60 * 1000
    const nowVn = new Date(nowUtc.getTime() + vnOffsetMs)
    const currentHour = nowVn.getUTCHours()
    const currentMinute = nowVn.getUTCMinutes()
    const isPastCutoff = currentHour > 16 || (currentHour === 16 && currentMinute >= 30)
    const minDiffDays = isPastCutoff ? 2 : 1
    const minValidTime = nowUtc.getTime() + 60 * 60 * 1000

    const todayVnStr = nowVn.toISOString().slice(0, 10)
    const baseDate = new Date(`${todayVnStr}T00:00:00.000Z`)

    return {
      nowUtc,
      nowVn,
      currentHour,
      currentMinute,
      isPastCutoff,
      minDiffDays,
      minValidTime,
      todayVnStr,
      baseDate,
    }
  }

  private async getClinicContext() {
    const { specialties, branches } = await this.getCachedClinicData()
    const specialtiesContext = specialties.map((s) => ({
      id: String(s.id),
      code: s.slug || String(s.id),
      name: s.name,
      description: s.description || undefined,
    }))
    return {
      specialtiesContext,
      clinicContext: { branches, specialties },
    }
  }

  // Định nghĩa Native Tools cho Gemini Function Calling
  private readonly agentTools = [
    {
      functionDeclarations: [
        {
          name: 'searchAvailableDoctorSlots',
          description:
            'Tra cứu lịch khám bác sĩ theo chuyên khoa, cơ sở và ngày cụ thể. Dùng khi người dùng muốn ĐẶT LỊCH HẸN KHÁM BÁC SĨ hoặc ĐẶT MỘT GÓI KHÁM CỤ THỂ (ví dụ: "đặt lịch khám mắt", "đặt giúp tôi gói tái khám mắt", "hẹn bác sĩ thứ 6"). Kết quả là Thẻ Đề Xuất Lịch Hẹn để người dùng xác nhận đặt chỗ.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              specialtyName: {
                type: Type.STRING,
                description:
                  'Tên chuyên khoa hoặc nhóm bệnh lý (ví dụ: Mắt, Tai Mũi Họng, Tim mạch, Tiêu hóa, Nhi khoa, v.v.)',
              },
              packageKeyword: {
                type: Type.STRING,
                description:
                  'Tên gói khám hoặc gói tái khám cụ thể nếu người dùng yêu cầu ĐẶT gói (ví dụ: "Tái khám Mắt", "Khám Mắt trong giờ", "Gói tầm soát tim mạch"). Hệ thống sẽ tự động gán đúng tên gói và giá tiền từ database.',
              },
              branchName: {
                type: Type.STRING,
                description:
                  'Tên cơ sở phòng khám mong muốn (ví dụ: "Cơ sở 1", "Cơ sở 2", "Quận 5", "Quận 7")',
              },
              targetDate: {
                type: Type.STRING,
                description:
                  'Ngày khám mong muốn theo định dạng YYYY-MM-DD (đối chiếu bảng lịch tuân thủ chính sách đặt trước)',
              },
              period: {
                type: Type.STRING,
                enum: ['MORNING', 'AFTERNOON', 'ALL'],
                description: 'Buổi khám mong muốn: MORNING (sáng), AFTERNOON (chiều), hoặc ALL (cả ngày)',
              },
            },
            required: ['specialtyName', 'targetDate'],
          },
        },
        {
          name: 'searchServicePackages',
          description:
            'Tra cứu và liệt kê danh sách các GÓI KHÁM / COMBO DỊCH VỤ để người dùng tham khảo bảng giá. Dùng khi người dùng muốn XEM / HỎI THÔNG TIN về gói khám (ví dụ: "có những gói khám nào", "xem danh sách gói mắt", "giá gói tổng quát là bao nhiêu"). KHÔNG dùng khi người dùng đã nói rõ "đặt" hoặc "chọn" một gói cụ thể.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              keyword: {
                type: Type.STRING,
                description:
                  'Từ khóa tìm kiếm gói khám (ví dụ: "mắt", "tầm soát ung thư", "tổng quát", "tim mạch", "tiêu hóa")',
              },
              specialtyName: {
                type: Type.STRING,
                description: 'Tên chuyên khoa nếu có',
              },
            },
            required: ['keyword'],
          },
        },
        {
          name: 'getPatientProfiles',
          description:
            'Lấy danh sách các hồ sơ bệnh nhân trong tài khoản người dùng hiện tại để chọn người đi khám.',
        },
      ],
    },
  ]

  // Regex PII
  private readonly phoneRegex = /(?:\+84|0)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b/g
  private readonly nationalIdRegex = /\b\d{12}\b|\b\d{9}\b/g
  private readonly emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  private readonly injectionPatterns = [
    /ignore\s+(previous|all)\s+instructions/i,
    /bỏ\s+qua\s+(toàn\s+bộ|hết|các)\s+chỉ\s+dẫn/i,
    /system\s+prompt/i,
    /you\s+are\s+now\s+a\s+doctor\s+prescribing/i,
    /bây\s+giờ\s+bạn\s+là\s+bác\s+sĩ\s+kê\s+đơn/i,
    /act\s+as\s+a\s+pharmacist/i,
    /hack|jailbreak/i,
  ]

  // Rx Blacklist & Emergency Red Flags
  private readonly rxBlacklist = [
    /\b(amoxicillin|augmentin|azithromycin|ciprofloxacin|cefixime|cephalexin|levofloxacin|clarithromycin)\b/gi,
    /\b(morphine|tramadol|codeine|fentanyl|diazepam|seduxen|alprazolam|lorazepam)\b/gi,
    /\b(prednisolone|dexamethasone|methylprednisolone)\b/gi,
    /\b(metformin|insulin|glimepiride|losartan|amlodipine|atorvastatin)\b/gi,
  ]
  private readonly emergencyKeywords = [
    'ngực dữ dội', 'khó thở cấp', 'vã mồ hôi lạnh', 'méo miệng',
    'liệt nửa người', 'nói đớ', 'co giật', 'nôn ra máu',
    'ngất xỉu', 'bất tỉnh', 'đau đầu sét đánh', 'sốt cao co giật',
  ]

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly bookingService: BookingService,
  ) {
    const geminiConfig = this.configService.get<{ apiKey?: string; model?: string }>('gemini')
    const apiKey = geminiConfig?.apiKey || this.configService.get<string>('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (geminiConfig?.model) this.modelName = geminiConfig.model

    if (apiKey) {
      this.aiClient = new GoogleGenAI({ apiKey })
      this.logger.log(`Google Gemini AI Client initialized (Model: ${this.modelName}).`)
    } else {
      this.logger.warn('Chưa cấu hình GEMINI_API_KEY trong .env. Sử dụng Rule-based Smart Triage Engine dự phòng.')
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 1. TƯ VẤN TRIỆU CHỨNG Y KHOA (REST)
  // ═════════════════════════════════════════════════════════════
  async processUserMessage(dto: AiChatMessageDto, currentUserId?: string): Promise<AiChatResponsePayload> {
    const sessionId = dto.sessionId || randomUUID()
    const { sanitizedText, hasRedactions } = this.sanitizeInput(dto.message)
    if (hasRedactions) {
      this.logger.log(`Session ${sessionId}: Đã khử định danh PII trong tin nhắn.`)
    }

    const { specialtiesContext, clinicContext } = await this.getClinicContext()

    const triage = await this.generateMedicalTriage(sanitizedText, specialtiesContext, clinicContext)
    const recommendations = await this.getClinicalRecommendations(triage.recommendedSpecialtyCodes)

    await this.persistConversation(sessionId, currentUserId, sanitizedText, dto.message, triage, recommendations, dto)

    return { sessionId, sanitizedQuery: sanitizedText, triage, recommendations }
  }

  // ═════════════════════════════════════════════════════════════
  // 2. TƯ VẤN TRIỆU CHỨNG STREAMING (SSE)
  // ═════════════════════════════════════════════════════════════
  async processUserMessageStream(dto: AiChatMessageDto, res: Response, currentUserId?: string): Promise<void> {
    const sessionId = dto.sessionId || randomUUID()

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const { sanitizedText } = this.sanitizeInput(dto.message)
      sendEvent('pii_sanitized', { sessionId, sanitizedText })

      const { specialtiesContext, clinicContext } = await this.getClinicContext()

      const triage = await this.streamMedicalTriage(sanitizedText, specialtiesContext, (token) => {
        sendEvent('token', { token })
      }, clinicContext)

      const recommendations = await this.getClinicalRecommendations(triage.recommendedSpecialtyCodes)
      sendEvent('recommendations', { recommendations, triage })

      await this.persistConversation(sessionId, currentUserId, sanitizedText, dto.message, triage, recommendations, dto)
      sendEvent('done', { sessionId })
    } catch (err: any) {
      this.logger.error(`Lỗi stream SSE: ${err?.message}`)
      sendEvent('error', { message: 'Đã xảy ra lỗi khi xử lý luồng AI stream.' })
    } finally {
      res.end()
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 3. AI BOOKING AGENT (ĐÀM THOẠI & TỰ ĐỘNG ĐẶT LỊCH)
  // ═════════════════════════════════════════════════════════════
  private getOrCreateSessionMemory(sessionId: string): AgentSessionMemory {
    const now = Date.now()
    for (const [id, session] of this.agentSessionMemories.entries()) {
      if (now - session.updatedAt > 30 * 60 * 1000) {
        this.agentSessionMemories.delete(id)
      }
    }

    const existing = this.agentSessionMemories.get(sessionId)
    if (existing) {
      existing.updatedAt = now
      // Context Window Pruning: Giữ tối đa 12 lượt gần nhất để tối ưu chi phí token và tốc độ phản hồi
      if (existing.history.length > 14) {
        existing.history = existing.history.slice(-10)
      }
      return existing
    }

    const newSession: AgentSessionMemory = { history: [], updatedAt: now }
    this.agentSessionMemories.set(sessionId, newSession)
    return newSession
  }

  // ═════════════════════════════════════════════════════════════
  // 3. AI BOOKING AGENT (ENTERPRISE NATIVE FUNCTION CALLING)
  // ═════════════════════════════════════════════════════════════
  async handleAgentMessage(dto: AiAgentChatDto, userId?: string): Promise<AiAgentChatResponse> {
    const sessionId = dto.sessionId || randomUUID()

    // A. Người dùng xác nhận đặt lịch
    if (dto.confirmBooking && dto.selectedSlotId) {
      return this.executeBookingConfirmation(sessionId, dto, userId)
    }

    // B. Guardrail 1: PII Sanitization
    const { sanitizedText } = this.sanitizeInput(dto.message)

    // C. Guardrail 2: Kiểm tra khẩn cấp Emergency Red Flags
    const lower = sanitizedText.toLowerCase()
    const isEmergency = this.emergencyKeywords.some((kw) => lower.includes(kw))
    if (isEmergency) {
      return {
        sessionId,
        step: 'COLLECTING_INFO',
        message:
          '🚨 **CẢNH BÁO Y TẾ KHẨN CẤP:** Triệu chứng bạn mô tả có dấu hiệu nguy hiểm tính mạng. Vui lòng gọi ngay cấp cứu **115** hoặc đến bệnh viện gần nhất có khoa cấp cứu. Không nên chờ đợi đặt lịch hẹn trực tuyến!',
        proposal: null,
      }
    }

    // D. Lấy bộ nhớ hội thoại của phiên (Session Memory)
    const session = this.getOrCreateSessionMemory(sessionId)
    session.history.push({
      role: 'user',
      parts: [{ text: sanitizedText }],
    })

    // Giữ kích thước history tối đa 16 lượt để tiết kiệm token
    if (session.history.length > 16) {
      session.history = session.history.slice(-12)
    }

    // Lấy danh sách hồ sơ người bệnh
    let availableProfiles: Array<{ id: string; fullName: string; isMain: boolean; relationship: string }> = []
    let defaultProfile: { id: string; fullName: string } | undefined
    if (userId) {
      const profRes = await this.executeGetPatientProfiles(userId)
      availableProfiles = profRes.profiles
      const matched = this.matchProfileFromText(sanitizedText, availableProfiles)
      defaultProfile = matched || availableProfiles[0]
    }

    // E. Gọi Gemini Agentic Loop với Native Function Calling (Multi-Step Enterprise Loop)
    if (this.aiClient) {
      try {
        const policy = this.getBookingLeadTimePolicy()
        const isPastCutoff = policy.isPastCutoff
        const minDiffDays = policy.minDiffDays

        const todayStr = policy.nowVn.toLocaleDateString('vi-VN', {
          weekday: 'long',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
        })
        const currentTimeStr = `${policy.currentHour.toString().padStart(2, '0')}:${policy.currentMinute.toString().padStart(2, '0')}`

        // Bảng đối chiếu 7 ngày tới TUÂN THỦ CHÍNH SÁCH ĐẶT LỊCH (Chặn đặt trong ngày & chặn đặt ngày mai sau 16h30)
        const calendarMap: string[] = []
        let earliestValidBookingDate = ''
        for (let i = 0; i < 7; i++) {
          const d = new Date(policy.nowVn)
          d.setDate(policy.nowVn.getDate() + i)
          const dayOfWeek = d.toLocaleDateString('vi-VN', { weekday: 'long', timeZone: 'Asia/Ho_Chi_Minh' })
          // Fix: dùng sv-SE locale để lấy YYYY-MM-DD chuẩn theo Asia/Ho_Chi_Minh, tránh lệch ngày khi server ở UTC+0
          const yyyyMmDd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
          let policyStatus = ''

          if (i === 0) {
            policyStatus = '-> [KHÔNG NHẬN ĐẶT TRỰC TUYẾN TRONG NGÀY: Khách hàng cần đến quầy tiếp đón trực tiếp]'
          } else if (i === 1 && isPastCutoff) {
            policyStatus = '-> [HẾT HẠN ĐẶT CHO NGÀY MAI: Đã quá mốc 16h30 quy định, phải đến quầy trực tiếp]'
          } else {
            policyStatus = '-> [HỢP LỆ ĐẶT LỊCH TRỰC TUYẾN]'
            if (!earliestValidBookingDate) earliestValidBookingDate = yyyyMmDd
          }

          const label = i === 0 ? 'Hôm nay' : i === 1 ? 'Ngày mai' : dayOfWeek
          calendarMap.push(`- ${label} (${dayOfWeek}): ${yyyyMmDd} ${policyStatus}`)
        }
        const calendarStr = calendarMap.join('\n')

        const systemInstruction = `Bạn là Trợ lý AI Đặt lịch khám bệnh & Điều phối Y tế (AI Booking Agent) của Hệ thống Phòng khám Đa khoa VitaCare.
Thời gian hiện tại: ${currentTimeStr}, ${todayStr}.
Các cơ sở VitaCare:
- Cơ sở 1: VitaCare Quận 5 (123 Nguyễn Tri Phương, Phường 7, Quận 5, TP.HCM)
- Cơ sở 2: VitaCare Quận 7 (456 Nguyễn Thị Thập, Phường Tân Phong, Quận 7, TP.HCM)

BẢNG ĐỐI CHIẾU LỊCH 7 NGÀY TỚI ĐỂ LẤY CHUẨN targetDate (YYYY-MM-DD):
${calendarStr}

CHÍNH SÁCH ĐẶT LỊCH TRỰC TUYẾN BẮT BUỘC TUÂN THỦ (BOOKING POLICY GUARDRAILS):
1. QUY ĐỊNH ĐẶT LỊCH TRONG NGÀY:
   - Hệ thống trực tuyến TUYỆT ĐỐI KHÔNG nhận đặt lịch khám cho ngày hôm nay.
   - Nếu người bệnh yêu cầu khám ngay trong ngày hôm nay, hãy ân cần giải thích rằng: "Theo chính sách phòng khám, hệ thống trực tuyến không nhận đặt lịch trong ngày để đảm bảo chất lượng phục vụ. Quý khách vui lòng đến trực tiếp quầy tiếp đón tại cơ sở để lấy số thứ tự khám ngay ạ."
2. QUY ĐỊNH GIỜ CHỐT SỔ CHO NGÀY MAI (CUTOFF 16H30):
   - Để khám vào ngày mai, người bệnh phải hoàn tất đặt lịch TRƯỚC 16h30 hôm nay.
   - Hiện tại: ${currentTimeStr} (${isPastCutoff ? 'ĐÃ QUÁ 16h30' : 'chưa quá 16h30'}).
   ${isPastCutoff ? `- VÌ HIỆN TẠI ĐÃ QUÁ 16h30, HỆ THỐNG ĐÃ KHÓA ĐẶT LỊCH CHO NGÀY MAI. Ngày khám sớm nhất có thể đặt lịch trực tuyến là: ${earliestValidBookingDate}.` : '- Ngày khám sớm nhất có thể đặt trực tuyến là ngày mai.'}
3. KHI CHỌN targetDate CHO CÔNG CỤ:
   - TUYỆT ĐỐI KHÔNG truyền ngày hôm nay ${isPastCutoff ? 'hoặc ngày mai' : ''} vào targetDate. CHỈ ĐƯỢC CHỌN ngày có gắn nhãn [HỢP LỆ ĐẶT LỊCH TRỰC TUYẾN] (sớm nhất là ${earliestValidBookingDate})!

QUY TẮC PHÂN BIỆT Ý ĐỊNH XEM DANH SÁCH vs ĐẶT LỊCH (CRITICAL INTENT ROUTING):
1. NẾU NGƯỜI DÙNG MUỐN XEM / TÌM HIỂU DANH SÁCH GÓI KHÁM (Hỏi tham khảo):
   - Các câu hỏi dạng tham khảo, liệt kê danh mục (KHÔNG CÓ TỪ ĐẶT/CHỐT):
     + Ví dụ: "cho tôi các gói khám mắt", "xem danh sách gói tái khám mắt", "ở đây có những gói khám nào", "tìm gói tầm soát tim mạch".
   - Ý định: THAM KHẢO DANH SÁCH GÓI!
   - Hành động: BẮT BUỘC gọi công cụ "searchServicePackages" với từ khóa (ví dụ: keyword: "tái khám mắt"). Giao diện sẽ hiển thị danh sách các gói để người dùng tham khảo.

2. NẾU NGƯỜI DÙNG YÊU CẦU ĐẶT LỊCH CHO MỘT GÓI CỤ THỂ HOẶC ĐẶT LỊCH BÁC SĨ:
   - Có từ khóa hành động chốt đặt: "đặt giúp tôi", "đặt lịch", "đặt gói", "chọn gói", "book":
     + Ví dụ: "đặt giúp tôi gói tái khám mắt", "đặt gói tái khám mắt", "tôi chọn gói tái khám mắt", "đặt ca khám mắt thứ 6".
   - Ý định: ĐẶT LỊCH GIỮ CHỖ (BOOKING ACTION)!
   - Hành động: BẮT BUỘC gọi công cụ "searchAvailableDoctorSlots" với:
     * specialtyName: "Mắt"
     * packageKeyword: "Tái khám Mắt" (nếu đặt gói khám)
     * targetDate: Ngày hợp lệ gần nhất theo chính sách (sớm nhất là ${earliestValidBookingDate})
   - TUYỆT ĐỐI KHÔNG ĐƯỢC gọi "searchServicePackages" khi người dùng đã nói "đặt giúp tôi gói..."! Vì người dùng đang muốn nhận Thẻ Lịch Hẹn Đề Xuất (Proposal Card) để bấm xác nhận đặt lịch ngay, chứ không muốn xem lại danh sách!

2. NẮM BẮT THÔNG TIN TÍCH LŨY TỪ LỊCH SỬ HỘI THOẠI (CHỐNG HỎI LẶP LẠI):
   - Hãy đọc kỹ toàn bộ các tin nhắn trước đó trong cuộc trò chuyện.
   - Người dùng thường cung cấp thông tin qua nhiều lượt (ví dụ lượt 1: 'Tôi muốn đặt lịch khám mắt', lượt 2: 'cơ sở 1').
   - Bạn PHẢI TỰ ĐỘNG GỘP CÁC THÔNG TIN LẠI: Chuyên khoa (Mắt), Ngày khám, Cơ sở (Cơ sở 1).
   - TUYỆT ĐỐI KHÔNG ĐƯỢC HỎI LẠI những thông tin đã có! Khi đã có Chuyên khoa + Cơ sở/Ngày, HÃY LẬP TỨC GỌI CÔNG CỤ thích hợp!

3. THAM SỐ CÔNG CỤ:
   - "searchAvailableDoctorSlots": specialtyName, branchName ("Cơ sở 1" hoặc "Cơ sở 2"), targetDate (YYYY-MM-DD, đối chiếu bảng lịch ở trên), period ('MORNING', 'AFTERNOON', hoặc 'ALL').
   - "searchServicePackages": keyword (từ khóa chuyên khoa/dịch vụ: tái khám mắt, mắt, tim mạch, tổng quát, v.v.).
   - "getPatientProfiles": không cần tham số, dùng để tra cứu hồ sơ người bệnh.

4. KHI NHẬN KẾT QUẢ TỪ CÔNG CỤ:
   - Nếu tìm thấy ca khám hoặc gói khám (found: true):
     Giao diện phòng khám đã tự động hiển thị Thẻ Ca Khám hoặc Danh Sách Gói Khám ở bảng bên cạnh. Bạn CHỈ CẦN NÓI NGẮN GỌN 1-2 CÂU ân cần (Ví dụ: "Dạ em đã tìm thấy các gói khám phù hợp theo yêu cầu của bạn ở bảng bên cạnh. Bạn xem và chọn gói khám nhé!").
   - Nếu không tìm thấy (found: false):
     Giải thích nhẹ nhàng là ngày/cơ sở đó hiện chưa có ca trống, và gợi ý người dùng chọn ngày khác. TUYỆT ĐỐI KHÔNG HỎI LẠI TỪ ĐẦU!

5. Tuyệt đối không tự ý kê đơn thuốc hoặc chẩn đoán khẳng định bệnh lý.
6. ĐỊNH DẠNG VĂN BẢN:
   - TUYỆT ĐỐI KHÔNG dùng ký tự markdown '**' hoặc '*' để in đậm trong văn bản trả lời.
   - Hãy viết văn bản thuần túy, tự nhiên, rõ ràng, dùng dấu gạch đầu dòng '-' thay vì dùng các ký hiệu markdown '**'.`

        let iterations = 0
        const MAX_ITERATIONS = 3
        let proposal: AiAgentBookingProposal | null = null
        let proposedPackages: PackageCardRecommendation[] | undefined
        let finalReplyText: string = ''

        while (iterations < MAX_ITERATIONS) {
          iterations++

          // Timeout Guardrail (12 giây tránh treo request khi Google API nghẽn mạng)
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('GEMINI_TIMEOUT_12S')), 12000),
          )

          let response: any
          try {
            response = await Promise.race([
              this.aiClient.models.generateContent({
                model: this.modelName,
                contents: session.history,
                config: {
                  systemInstruction,
                  tools: this.agentTools,
                  temperature: 0.2,
                },
              }),
              timeoutPromise,
            ])
          } catch (callErr: any) {
            if (callErr?.message?.includes('503') || callErr?.status === 'UNAVAILABLE') {
              this.logger.warn(`Model ${this.modelName} quá tải tạm thời (503), tự động chuyển đổi sang gemini-2.5-flash...`)
              response = await this.aiClient.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: session.history,
                config: {
                  systemInstruction,
                  tools: this.agentTools,
                  temperature: 0.2,
                },
              })
            } else {
              throw callErr
            }
          }

          const functionCalls = response.functionCalls
          const candidateParts = response.candidates?.[0]?.content?.parts

          if (!functionCalls || functionCalls.length === 0) {
            finalReplyText = response.text || ''
            session.history.push({
              role: 'model',
              parts: candidateParts || [{ text: finalReplyText }],
            })
            break
          }

          // Xử lý Function Call
          const call = functionCalls[0]
          let toolResult: any = null

          if (call.name === 'searchAvailableDoctorSlots') {
            toolResult = await this.executeSearchDoctorSlots(call.args as any)
            if (toolResult.found && toolResult.slot) {
              const s = toolResult.slot
              proposal = {
                slotId: s.id,
                servicePackageId: s.servicePackageId,
                doctorId: s.doctorId,
                doctorName: s.doctorName,
                specialtyName: s.specialtyName,
                packageName: s.packageName,
                description: s.description,
                branchId: s.branchId,
                branchName: s.branchName,
                date: s.date,
                startTime: s.startTime,
                endTime: s.endTime,
                fee: s.fee,
                patientProfileId: defaultProfile?.id,
                patientProfileName: defaultProfile?.fullName,
              }
              session.lastProposal = proposal
            }
          } else if (call.name === 'searchServicePackages') {
            toolResult = await this.executeSearchServicePackages(call.args as any)
            if (toolResult.found && toolResult.packages) {
              proposedPackages = toolResult.packages
              session.lastPackages = proposedPackages
            }
          } else if (call.name === 'getPatientProfiles') {
            toolResult = await this.executeGetPatientProfiles(userId)
            if (toolResult.profiles && toolResult.profiles.length > 0) {
              availableProfiles = toolResult.profiles
            }
          }

          // Đảm bảo toolResult luôn là một JSON Object thuần túy (không null/undefined)
          const safeToolResult =
            toolResult && typeof toolResult === 'object' ? toolResult : { status: 'empty' }

          session.history.push({
            role: 'model',
            parts: candidateParts || [{ functionCall: call }],
          })
          session.history.push({
            role: 'user',
            parts: [{ functionResponse: { name: call.name, response: safeToolResult } }],
          })
        }

        if (!finalReplyText) {
          finalReplyText = proposal
            ? 'Dạ em đã tìm thấy ca khám phù hợp cho bạn. Bạn xem chi tiết ở bảng bên cạnh và bấm xác nhận để em giữ chỗ nhé!'
            : proposedPackages && proposedPackages.length > 0
              ? 'Dạ em đã tìm thấy danh sách gói khám phù hợp cho bạn ở bảng bên cạnh. Bạn chọn gói khám ưng ý để tiến hành đặt lịch nhé!'
              : 'Bạn có thể cung cấp thêm thông tin về chuyên khoa, cơ sở hoặc thời gian bạn muốn khám không ạ?'
        }

        if (proposal) {
          return {
            sessionId,
            step: 'PROPOSED',
            message: finalReplyText,
            proposal,
            quickSuggestions: ['Đổi khung giờ khác', 'Đổi ngày khám', 'Đổi sang Cơ sở 2'],
            availableProfiles,
          }
        }

        if (proposedPackages && proposedPackages.length > 0) {
          return {
            sessionId,
            step: 'PROPOSED',
            message: finalReplyText,
            proposal: null,
            proposedPackages,
            quickSuggestions: ['Đặt lịch khám bác sĩ', 'Xem thêm gói khác', 'Tư vấn thêm'],
            availableProfiles,
          }
        }

        // Tạo quickSuggestions thông minh theo ngữ cảnh câu trả lời
        const quickSuggestions: string[] = []
        const rLower = finalReplyText.toLowerCase()
        if (rLower.includes('cơ sở') || rLower.includes('chi nhánh') || rLower.includes('ở đâu')) {
          quickSuggestions.push('Cơ sở 1 (Quận 5)', 'Cơ sở 2 (Quận 7)')
        }
        if (rLower.includes('ngày') || rLower.includes('khi nào') || rLower.includes('thời gian') || rLower.includes('giờ') || rLower.includes('buổi')) {
          quickSuggestions.push('Sáng mai', 'Chiều mai', 'Sáng thứ Bảy', 'Sáng Chủ Nhật')
        }
        if (rLower.includes('chuyên khoa') || rLower.includes('khám gì') || rLower.includes('triệu chứng')) {
          quickSuggestions.push('Khám Mắt', 'Khám Tim Mạch', 'Khám Tiêu Hóa', 'Khám Tổng Quát')
        }
        if (quickSuggestions.length === 0) {
          quickSuggestions.push('Khám tổng quát', 'Cơ sở 1 sáng mai', 'Xem các gói khám')
        }

        return {
          sessionId,
          step: 'COLLECTING_INFO',
          message: finalReplyText,
          proposal: null,
          quickSuggestions,
          availableProfiles,
        }
      } catch (err: any) {
        this.logger.error(`Gemini Agentic Execution Loop Error: ${err?.message}`, err?.stack)
      }
    }

    // F. Smart Fallback Engine (khi mất kết nối internet hoặc không có API Key)
    return this.fallbackHandleAgentMessage(sessionId, sanitizedText, userId, availableProfiles, defaultProfile)
  }

  private async executeSearchDoctorSlots(args: {
    specialtyName: string
    packageKeyword?: string
    branchName?: string
    targetDate: string
    period?: string
  }) {
    const { specialties, branches } = await this.getCachedClinicData()

    // 0. Nếu người dùng muốn đặt cho một gói khám cụ thể (packageKeyword)
    let targetPackage: any = null
    if (args.packageKeyword) {
      const raw = args.packageKeyword.toLowerCase()

      // Bước 1: Nhận diện LOẠI GÓI từ từ khóa (tránh phụ thuộc vào Vietnamese ILIKE collation)
      // Các mẫu tên gói trong DB: "Tái khám X", "Tư vấn X", "Khám X trong giờ", "Khám X ngoài giờ"
      const packageTypeKeyword: string | null =
        raw.includes('tái khám') || raw.includes('tai kham') || raw.includes('followup') ? 'Tái khám' :
          raw.includes('tư vấn') || raw.includes('tu van') || raw.includes('advice') ? 'Tư vấn' :
            raw.includes('ngoài giờ') || raw.includes('ngoai gio') || raw.includes('after') ? 'ngoài giờ' :
              raw.includes('trong giờ') || raw.includes('trong gio') || raw.includes('standard') ? 'trong giờ' :
                null

      // Bước 2: Nhận diện CHUYÊN KHOA từ từ khóa hoặc fallback sang args.specialtyName
      const specNameGuess = args.specialtyName || ''

      console.log(`[PackageSearch] raw="${args.packageKeyword}" → typeKeyword="${packageTypeKeyword}" specGuess="${specNameGuess}"`)

      if (packageTypeKeyword && specNameGuess) {
        // Tier A: Tìm đúng loại gói + đúng chuyên khoa (chính xác nhất)
        targetPackage = await this.prisma.servicePackage.findFirst({
          where: {
            isActive: true,
            name: { contains: packageTypeKeyword, mode: 'insensitive' },
            specialty: { name: { contains: specNameGuess, mode: 'insensitive' } },
          },
          include: { specialty: true, branchBookingMethod: { include: { branch: true } } },
          orderBy: { price: 'asc' },
        })
      }

      if (!targetPackage && packageTypeKeyword) {
        // Tier B: Chỉ khớp loại gói (khi không xác định được chuyên khoa)
        targetPackage = await this.prisma.servicePackage.findFirst({
          where: {
            isActive: true,
            name: { contains: packageTypeKeyword, mode: 'insensitive' },
          },
          include: { specialty: true, branchBookingMethod: { include: { branch: true } } },
          orderBy: { price: 'asc' },
        })
      }

      if (!targetPackage && specNameGuess) {
        // Tier C: Fallback — gói rẻ nhất của chuyên khoa khi không xác định được loại gói
        targetPackage = await this.prisma.servicePackage.findFirst({
          where: {
            isActive: true,
            specialty: { name: { contains: specNameGuess, mode: 'insensitive' } },
          },
          include: { specialty: true, branchBookingMethod: { include: { branch: true } } },
          orderBy: { price: 'asc' },
        })
      }
    }


    // 🔍 DEBUG LOG — kiểm tra gói khám được trả về
    console.log(
      `[PackageSearch] keyword="${args.packageKeyword}" specialtyName="${args.specialtyName}" → found:`,
      targetPackage ? { name: targetPackage.name, price: targetPackage.price, id: targetPackage.id } : null,
    )

    const extracted = this.ruleBasedExtractCriteria(

      args.specialtyName,
      specialties,
      branches,
      args.branchName,
    )

    const targetSpecialty = targetPackage?.specialty || extracted.targetSpecialty
    const targetBranch = targetPackage?.branchBookingMethod?.branch || extracted.targetBranch

    const dateObj = new Date(args.targetDate)
    let slot = await this.findAvailableSlotsForAgent({
      specialtyId: targetSpecialty?.id,
      branchId: targetBranch?.id,
      targetDate: isNaN(dateObj.getTime()) ? new Date() : dateObj,
      period: (args.period as any) || 'ALL',
    })

    // Nếu không tìm thấy tại cơ sở chỉ định, thử tìm kiếm ở các cơ sở còn lại
    if (!slot && targetBranch) {
      slot = await this.findAvailableSlotsForAgent({
        specialtyId: targetSpecialty?.id,
        targetDate: isNaN(dateObj.getTime()) ? new Date() : dateObj,
        period: (args.period as any) || 'ALL',
      })
    }

    // Nếu vẫn chưa có, tìm ca khám gần nhất từ ngày hợp lệ theo chính sách
    if (!slot) {
      slot = await this.findAvailableSlotsForAgent({
        specialtyId: targetSpecialty?.id,
        targetDate: new Date(),
        period: 'ALL',
      })
    }

    if (!slot) {
      return {
        found: false,
        message: `Hiện tại hệ thống chưa có ca khám trống cho ${targetPackage ? `gói ${targetPackage.name}` : `chuyên khoa ${targetSpecialty?.name || args.specialtyName}`}. Bạn có thể chọn ngày khác hoặc liên hệ hotline để được hỗ trợ.`,
      }
    }

    const specName = slot.schedule.doctor.specialties?.[0]?.specialty?.name || targetSpecialty?.name || 'Khám chuyên khoa'

    return {
      found: true,
      slot: {
        id: slot.id,
        servicePackageId: targetPackage?.id,
        doctorId: slot.schedule.doctorId,
        doctorName: slot.schedule.doctor.user?.fullName
          ? `${slot.schedule.doctor.academicRank ? slot.schedule.doctor.academicRank + ' ' : ''}${slot.schedule.doctor.user.fullName}`.trim()
          : 'Bác sĩ chuyên khoa',
        specialtyName: specName,
        packageName: targetPackage ? targetPackage.name : undefined,
        description: targetPackage ? targetPackage.description : `Khám lâm sàng, kiểm tra chuyên sâu và tư vấn điều trị trực tiếp cùng bác sĩ chuyên khoa ${specName}.`,
        branchId: targetBranch?.id || slot.schedule.branchId,
        branchName: targetBranch?.name || slot.schedule.branch?.name || 'VitaCare Clinic',
        date: slot.schedule.workDate.toISOString().slice(0, 10),
        startTime: slot.startTime.toISOString().slice(11, 16),
        endTime: slot.endTime.toISOString().slice(11, 16),
        fee: targetPackage ? Number(targetPackage.price) : Number(slot.schedule.doctor.consultationFee || 200000),
      },
    }
  }

  private async executeSearchServicePackages(args: { keyword: string; specialtyName?: string }) {
    const raw = `${args.keyword || ''} ${args.specialtyName || ''}`.trim()

    // 1. Lọc bỏ chỉ các từ đệm hội thoại (đại từ, động từ hành động), GIỮ LẠI danh từ y tế như "gói", "tầm soát", "tổng quát"
    // Không xóa: gói, tầm soát, tổng quát, combo, dịch vụ — vì đây là từ khóa y tế có nghĩa
    const cleaned = raw
      .toLowerCase()
      .replace(/\b(đặt|giúp|tôi|em|anh|chị|mình|cho|với|xem|tìm|hộ|nhé|nha|ạ|được|không|có)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()

    // 2. Nếu không truyền keyword và cleaned rỗng, hiển thị các gói khám tiêu biểu
    if (!cleaned && !raw) {
      const packages = await this.prisma.servicePackage.findMany({
        where: { isActive: true },
        include: {
          specialty: true,
          branchBookingMethod: { include: { branch: true } },
        },
        orderBy: [{ price: 'asc' }],
        take: 6,
      })

      return {
        found: packages.length > 0,
        count: packages.length,
        packages: packages.map((pkg) => ({
          id: pkg.id,
          code: pkg.code,
          name: pkg.name,
          description: pkg.description || `Gói khám và dịch vụ chăm sóc sức khỏe chuyên khoa ${pkg.specialty?.name || ''}`,
          price: Number(pkg.price),
          branchName: pkg.branchBookingMethod?.branch?.name || 'VitaCare Clinic',
        })),
      }
    }

    // 3. Tự động kiểm tra khớp chuyên khoa từ DB (Data-driven)
    const specialties = await this.prisma.specialty.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    })

    const targetTerm = cleaned || raw
    const matchedSpec = specialties.find(
      (s) =>
        targetTerm.toLowerCase().includes(s.name.toLowerCase()) ||
        raw.toLowerCase().includes(s.name.toLowerCase()),
    )

    const packages = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        OR: [
          ...(matchedSpec ? [{ specialtyId: matchedSpec.id }] : []),
          ...(cleaned ? [{ name: { contains: cleaned, mode: 'insensitive' as const } }] : []),
          { name: { contains: raw, mode: 'insensitive' as const } },
          ...(cleaned ? [{ description: { contains: cleaned, mode: 'insensitive' as const } }] : []),
          { description: { contains: raw, mode: 'insensitive' as const } },
          { specialty: { name: { contains: targetTerm, mode: 'insensitive' as const } } },
        ],
      },
      include: {
        specialty: true,
        branchBookingMethod: { include: { branch: true } },
      },
      orderBy: [{ price: 'asc' }],
      take: 8,
    })

    // 4. Xếp hạng thông minh (Smart Ranking): Đẩy gói có tên khớp từ khóa tìm kiếm (VD: "Tái khám Mắt") lên vị trí đầu tiên
    if (cleaned) {
      const cLower = cleaned.toLowerCase()
      packages.sort((a, b) => {
        const aName = a.name.toLowerCase()
        const bName = b.name.toLowerCase()
        const aExact = aName.includes(cLower) ? 2 : (cLower.split(' ').some((w) => w.length > 2 && aName.includes(w)) ? 1 : 0)
        const bExact = bName.includes(cLower) ? 2 : (cLower.split(' ').some((w) => w.length > 2 && bName.includes(w)) ? 1 : 0)
        return bExact - aExact
      })
    }

    return {
      found: packages.length > 0,
      count: packages.length,
      packages: packages.slice(0, 6).map((pkg) => ({
        id: pkg.id,
        code: pkg.code,
        name: pkg.name,
        description: pkg.description || `Gói khám và dịch vụ chăm sóc sức khỏe chuyên khoa ${pkg.specialty?.name || ''}`,
        price: Number(pkg.price),
        branchName: pkg.branchBookingMethod?.branch?.name || 'VitaCare Clinic',
      })),
    }
  }

  private async executeGetPatientProfiles(userId?: string) {
    if (!userId) return { count: 0, profiles: [] }
    const profiles = await this.prisma.patientProfile.findMany({
      where: { accountId: userId },
      orderBy: [{ isMainProfile: 'desc' }, { createdAt: 'asc' }],
    })
    return {
      count: profiles.length,
      profiles: profiles.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        isMain: p.isMainProfile,
        relationship: p.relationshipToAccount || 'Bản thân',
      })),
    }
  }

  private async fallbackHandleAgentMessage(
    sessionId: string,
    sanitizedText: string,
    userId?: string,
    availableProfiles: Array<{ id: string; fullName: string; isMain: boolean; relationship: string }> = [],
    defaultProfile?: { id: string; fullName: string },
  ): Promise<AiAgentChatResponse> {
    const lower = sanitizedText.toLowerCase()
    const hasBookingVerb =
      lower.includes('đặt') ||
      lower.includes('book') ||
      lower.includes('chọn') ||
      lower.includes('hẹn') ||
      lower.includes('lấy')
    const isPackageKeyword =
      lower.includes('gói') ||
      lower.includes('tái khám') ||
      lower.includes('tư vấn') ||
      lower.includes('tầm soát') ||
      lower.includes('trọn gói') ||
      lower.includes('combo') ||
      lower.includes('package')

    // 1. NẾU CÓ Ý ĐỊNH ĐẶT GÓI (ĐẶT + GÓI/TÁI KHÁM):
    if (hasBookingVerb && isPackageKeyword) {
      const toolRes = await this.executeSearchDoctorSlots({
        specialtyName: 'Mắt',
        packageKeyword: sanitizedText,
        targetDate: new Date().toISOString().slice(0, 10),
      })
      if (toolRes.found && toolRes.slot) {
        const s = toolRes.slot
        const proposal: AiAgentBookingProposal = {
          slotId: s.id,
          servicePackageId: s.servicePackageId,
          doctorId: s.doctorId,
          doctorName: s.doctorName,
          specialtyName: s.specialtyName,
          packageName: s.packageName,
          description: s.description,
          branchId: s.branchId,
          branchName: s.branchName,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          fee: s.fee,
          patientProfileId: defaultProfile?.id,
          patientProfileName: defaultProfile?.fullName,
        }
        const session = this.getOrCreateSessionMemory(sessionId)
        session.lastProposal = proposal
        return {
          sessionId,
          step: 'PROPOSED',
          message: `Dạ em đã tìm thấy lịch khám phù hợp cho ${s.packageName || 'gói khám'} tại ${s.branchName}. Bạn xem chi tiết ở bảng bên cạnh và bấm xác nhận để em giữ chỗ nhé!`,
          proposal,
          availableProfiles,
        }
      }
    }

    // 2. NẾU CHỈ HỎI XEM / LIỆT KÊ DANH SÁCH GÓI KHÁM (không có từ ĐẶT):
    if (isPackageKeyword && !hasBookingVerb) {
      const toolRes = await this.executeSearchServicePackages({ keyword: sanitizedText })
      if (toolRes.packages && toolRes.packages.length > 0) {
        return {
          sessionId,
          step: 'PROPOSED',
          message: 'Dạ, em đã tìm thấy danh sách các gói khám phù hợp theo yêu cầu của bạn ở bảng bên cạnh:',
          proposal: null,
          proposedPackages: toolRes.packages,
          availableProfiles,
        }
      }
    }

    const { specialties, branches } = await this.getCachedClinicData()

    const criteria = this.ruleBasedExtractCriteria(sanitizedText, specialties, branches)
    const targetDate = new Date()
    const bestSlot = await this.findAvailableSlotsForAgent({
      specialtyId: criteria.specialtyId,
      branchId: criteria.branchId,
      targetDate,
      period: criteria.period,
    })

    if (!bestSlot) {
      return {
        sessionId,
        step: 'COLLECTING_INFO',
        message: 'Bạn muốn đặt lịch khám tại Cơ sở 1 (Quận 5) hay Cơ sở 2 (Quận 7), và bạn dự định đi khám vào ngày nào ạ?',
        proposal: null,
        quickSuggestions: ['Cơ sở 1 sáng mai', 'Cơ sở 2 sáng mai', 'Cuối tuần này'],
        availableProfiles,
      }
    }

    const specName = bestSlot.schedule.doctor.specialties?.[0]?.specialty?.name || 'Khám chuyên khoa'
    const proposal: AiAgentBookingProposal = {
      slotId: bestSlot.id,
      doctorId: bestSlot.schedule.doctorId,
      doctorName: bestSlot.schedule.doctor.user?.fullName || 'Bác sĩ chuyên khoa',
      specialtyName: specName,
      packageName: `Gói khám chuyên khoa ${specName}`,
      description: `Khám lâm sàng, kiểm tra chuyên sâu và tư vấn trực tiếp cùng bác sĩ chuyên khoa ${specName}.`,
      branchId: bestSlot.schedule.branchId,
      branchName: bestSlot.schedule.branch?.name || 'VitaCare Clinic',
      date: bestSlot.schedule.workDate.toISOString().slice(0, 10),
      startTime: bestSlot.startTime.toISOString().slice(11, 16),
      endTime: bestSlot.endTime.toISOString().slice(11, 16),
      fee: Number(bestSlot.schedule.doctor.consultationFee || 200000),
      patientProfileId: defaultProfile?.id,
      patientProfileName: defaultProfile?.fullName,
    }

    return {
      sessionId,
      step: 'PROPOSED',
      message: `Dạ, em đã tìm thấy lịch khám phù hợp tại ${proposal.branchName}. Bạn xem chi tiết ở bảng bên cạnh và bấm xác nhận để em giữ chỗ nhé!`,
      proposal,
      availableProfiles,
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 4. THỰC THI TẠO LỊCH HẸN TRỰC TIẾP
  // ═════════════════════════════════════════════════════════════
  private async executeBookingConfirmation(
    sessionId: string,
    dto: AiAgentChatDto,
    userId?: string,
  ): Promise<AiAgentChatResponse> {
    if (!userId) {
      return {
        sessionId,
        step: 'ERROR',
        message: 'Vui lòng đăng nhập tài khoản để AI Agent tiến hành tạo lịch hẹn và giữ chỗ cho bạn.',
        proposal: null,
      }
    }

    let profileId = dto.selectedProfileId
    if (!profileId) {
      const profile = await this.prisma.patientProfile.findFirst({
        where: { accountId: userId },
        orderBy: [{ isMainProfile: 'desc' }, { createdAt: 'asc' }],
      })
      if (!profile) {
        return {
          sessionId,
          step: 'ERROR',
          message: 'Tài khoản của bạn chưa có hồ sơ bệnh nhân. Vui lòng tạo hồ sơ bệnh nhân trước khi đặt lịch.',
          proposal: null,
        }
      }
      profileId = profile.id
    }

    try {
      const session = this.getOrCreateSessionMemory(sessionId)
      const selectedPkgId = dto.servicePackageId || session.lastProposal?.servicePackageId

      const checkoutResult = await this.bookingService.checkout(userId, {
        bookingMethodCode: selectedPkgId ? 'SPECIALTY_EXAM' : 'CONSULTATION',
        servicePackageId: selectedPkgId,
        scheduleSlotId: dto.selectedSlotId,
        patientProfileId: profileId,
        bookedViaAi: true,
        symptomsDescription: dto.message || 'Đặt lịch qua AI Booking Agent',
      })

      const appt = await this.prisma.appointment.findUnique({
        where: { id: checkoutResult.appointmentId },
        include: {
          scheduleSlot: {
            include: {
              schedule: {
                include: {
                  doctor: { include: { user: true } },
                  branch: true,
                },
              },
            },
          },
          patientProfile: true,
        },
      })

      await this.prisma.aIBookingIntentLog.create({
        data: {
          conversationId: sessionId,
          userId,
          detectedIntent: 'AUTONOMOUS_SLOT_BOOKING',
          isSuccessful: true,
          appointmentId: checkoutResult.appointmentId,
          extractedParams: {
            slotId: dto.selectedSlotId,
            profileId,
            totalAmount: checkoutResult.totalAmount,
          },
        },
      }).catch((e) => this.logger.warn(`Lỗi ghi log AI Booking: ${e.message}`))

      this.agentSessionMemories.delete(sessionId)

      return {
        sessionId,
        step: 'SUCCESS',
        message: `🎉 **Đặt lịch khám thành công!**\n- Mã đặt khám: **${appt?.bookingCode || 'Đang cập nhật'}**\n- Người khám: **${appt?.patientProfile?.fullName || ''}**\n- Khung giờ: **${appt?.scheduleSlot?.startTime?.toISOString().slice(11, 16)}** ngày **${appt?.scheduleSlot?.schedule?.workDate?.toISOString().slice(0, 10)}**\n- Trạng thái: **Đang giữ chỗ 10 phút để thanh toán**\n\nBạn có thể tiến hành thanh toán hoặc xuất trình mã này khi tới quầy tiếp đón!`,
        bookingResult: {
          appointmentId: checkoutResult.appointmentId,
          bookingCode: appt?.bookingCode || '',
          totalAmount: Number(checkoutResult.totalAmount),
          holdExpiresAt: checkoutResult.holdExpiresAt.toISOString(),
          paymentId: checkoutResult.paymentId,
        },
      }
    } catch (err: any) {
      const errorMsg = `Không thể hoàn tất đặt lịch: ${err?.message || 'Khung giờ có thể vừa hết chỗ'}. Vui lòng thử lại.`
      const session = this.agentSessionMemories.get(sessionId)
      if (session) {
        session.history.push({
          role: 'model',
          parts: [{ text: `[LỖI ĐẶT LỊCH]: ${errorMsg}` }],
        })
      }
      return {
        sessionId,
        step: 'ERROR',
        message: errorMsg,
        proposal: null,
      }
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 5. HELPER: LÀM SẠCH DỮ LIỆU & BẢO MẬT (PII & INJECTION)
  // ═════════════════════════════════════════════════════════════
  private sanitizeInput(rawText: string): { sanitizedText: string; hasRedactions: boolean } {
    let sanitized = rawText
    let hasRedactions = false

    if (this.phoneRegex.test(sanitized)) {
      sanitized = sanitized.replace(this.phoneRegex, '[SỐ ĐIỆN THOẠI ĐÃ ĐƯỢC ẨN]')
      hasRedactions = true
    }
    if (this.nationalIdRegex.test(sanitized)) {
      sanitized = sanitized.replace(this.nationalIdRegex, '[CCCD/MÃ ĐỊNH DANH ĐÃ ẨN]')
      hasRedactions = true
    }
    if (this.emailRegex.test(sanitized)) {
      sanitized = sanitized.replace(this.emailRegex, '[EMAIL ĐÃ ẨN]')
      hasRedactions = true
    }
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '[LỆNH KHÔNG HỢP LỆ]')
      }
    }
    return { sanitizedText: sanitized.trim(), hasRedactions }
  }

  // ═════════════════════════════════════════════════════════════
  // 6. HELPER: TRUY VẤN DỮ LIỆU LÂM SÀNG & KHÁM BỆNH TỪ DB
  // ═════════════════════════════════════════════════════════════


  private async getClinicalRecommendations(specialtyCodes: string[]) {
    if (!specialtyCodes || specialtyCodes.length === 0) {
      return { specialties: [], doctors: [], packages: [] }
    }

    const specialties = await this.prisma.specialty.findMany({
      where: {
        isActive: true,
        OR: [
          { slug: { in: specialtyCodes } },
          { id: { in: specialtyCodes.map((c) => Number(c)).filter((n) => !isNaN(n)) } },
          { name: { in: specialtyCodes } },
        ],
      },
    })
    const specialtyIds = specialties.map((s) => s.id)

    const doctorsList = await this.prisma.doctor.findMany({
      where: {
        isActive: true,
        specialties: { some: { specialtyId: { in: specialtyIds } } },
      },
      include: {
        user: { select: { fullName: true } },
        specialties: { include: { specialty: true } },
        schedules: { take: 1, include: { branch: { select: { name: true } } } },
      },
      take: 6,
    })

    const doctors: DoctorCardRecommendation[] = doctorsList.map((doc) => ({
      id: doc.id,
      fullName: doc.user?.fullName || 'Bác sĩ chuyên khoa',
      title: doc.academicRank || 'Bác sĩ',
      avatarUrl: doc.avatarUrl || undefined,
      specialtyName: doc.specialties[0]?.specialty?.name || 'Đa khoa',
      branchName: doc.schedules[0]?.branch?.name || 'Phòng khám VitaCare',
      consultationFee: Number(doc.consultationFee || 200000),
    }))

    const servicePackages = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        specialtyId: { in: specialtyIds },
      },
      take: 6,
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        branchBookingMethod: { select: { branch: { select: { name: true } } } },
      },
    })

    const packages: PackageCardRecommendation[] = servicePackages.map((pkg) => ({
      id: pkg.id,
      code: pkg.code,
      name: pkg.name,
      price: Number(pkg.price),
      branchName: pkg.branchBookingMethod?.branch?.name,
    }))

    return {
      specialties: specialties.map((s) => ({
        id: String(s.id),
        code: s.slug || String(s.id),
        name: s.name,
        description: s.description || undefined,
        iconUrl: s.iconUrl || undefined,
      })),
      doctors,
      packages,
    }
  }

  private async findAvailableSlotsForAgent(criteria: {
    specialtyId?: number
    branchId?: string
    targetDate: Date
    period: 'MORNING' | 'AFTERNOON' | 'ALL'
  }) {
    // Áp dụng chuẩn chính sách đặt lịch (lead-time) tập trung
    const policy = this.getBookingLeadTimePolicy()

    let searchDate = new Date(criteria.targetDate)
    const searchDateStr = searchDate.toISOString().slice(0, 10)
    const searchDateOnly = new Date(`${searchDateStr}T00:00:00.000Z`)
    const diffDays = Math.round((searchDateOnly.getTime() - policy.baseDate.getTime()) / (24 * 60 * 60 * 1000))

    // Nếu ngày yêu cầu vi phạm chính sách đặt lịch (< minDiffDays), tự động dời về ngày hợp lệ sớm nhất theo quy định
    if (diffDays < policy.minDiffDays) {
      searchDate = new Date(policy.baseDate.getTime() + policy.minDiffDays * 24 * 60 * 60 * 1000)
    }

    const fromDate = new Date(Date.UTC(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate(), 0, 0, 0))
    const toDate = new Date(fromDate)
    toDate.setDate(toDate.getDate() + 14)

    const slots = await this.prisma.doctorScheduleSlot.findMany({
      where: {
        isActive: true,
        slotStatus: 'AVAILABLE',
        schedule: {
          status: 'OPEN',
          workDate: { gte: fromDate, lte: toDate },
          ...(criteria.branchId ? { branchId: criteria.branchId } : {}),
          ...(criteria.specialtyId ? { doctor: { specialties: { some: { specialtyId: criteria.specialtyId } } } } : {}),
        },
      },
      include: {
        schedule: {
          include: {
            doctor: {
              include: {
                user: true,
                specialties: { include: { specialty: true } },
              },
            },
            branch: true,
          },
        },
      },
      orderBy: [{ schedule: { workDate: 'asc' } }, { startTime: 'asc' }],
      take: 40,
    })

    // Lọc bỏ triệt để các ca trong quá khứ hoặc vi phạm thời gian quy định đặt trước (1 tiếng)
    const available = slots.filter((s) => {
      if (s.occupiedCount >= s.capacity) return false

      const wDate = new Date(s.schedule.workDate)
      const sTime = new Date(s.startTime)
      const slotActualTime = new Date(
        wDate.getFullYear(),
        wDate.getMonth(),
        wDate.getDate(),
        sTime.getUTCHours(),
        sTime.getUTCMinutes(),
      ).getTime()

      return slotActualTime >= policy.minValidTime
    })

    if (available.length === 0) return null

    if (criteria.period === 'MORNING') {
      const morningSlot = available.find((s) => s.startTime.getUTCHours() < 12)
      if (morningSlot) return morningSlot
    } else if (criteria.period === 'AFTERNOON') {
      const afternoonSlot = available.find((s) => s.startTime.getUTCHours() >= 12)
      if (afternoonSlot) return afternoonSlot
    }

    return available[0]
  }

  private ruleBasedExtractCriteria(
    text: string,
    specialties: any[],
    branches: any[],
    explicitBranchName?: string,
  ) {
    const lower = (text || '').toLowerCase()
    const bLower = (explicitBranchName || text || '').toLowerCase()

    // 1. Khớp chuyên khoa theo tên trong DB (Data-driven)
    const matchedSpec = specialties.find(
      (s) =>
        lower.includes(s.name.toLowerCase()) ||
        s.name.toLowerCase().includes(lower) ||
        (s.slug && lower.includes(s.slug.toLowerCase())),
    )
    const targetSpecialty = matchedSpec || specialties[0]

    // 2. Khớp cơ sở theo tên hoặc địa chỉ trong DB
    const targetBranch =
      branches.find(
        (b) =>
          bLower.includes(b.name.toLowerCase()) ||
          b.name.toLowerCase().includes(bLower) ||
          (b.address && bLower.includes(b.address.toLowerCase())) ||
          (bLower.includes('1') && b.name.includes('1')) ||
          (bLower.includes('2') && b.name.includes('2')) ||
          (bLower.includes('5') && b.address?.includes('5')) ||
          (bLower.includes('7') && b.address?.includes('7')),
      ) || null

    let period: 'MORNING' | 'AFTERNOON' | 'ALL' = 'ALL'
    if (lower.includes('sáng')) period = 'MORNING'
    else if (lower.includes('chiều') || lower.includes('tối')) period = 'AFTERNOON'

    return {
      specialtyId: targetSpecialty?.id,
      branchId: targetBranch?.id,
      targetSpecialty,
      targetBranch,
      period,
    }
  }

  private matchProfileFromText(text: string, profiles: Array<{ id: string; fullName: string; relationship: string }>) {
    const lower = text.toLowerCase()
    return profiles.find((p) => lower.includes(p.fullName.toLowerCase()) || lower.includes(p.relationship.toLowerCase())) || null
  }

  // ═════════════════════════════════════════════════════════════
  // 7. HELPER: GOOGLE GEMINI & RULE-BASED TRIAGE
  // ═════════════════════════════════════════════════════════════

  /** Xây dựng system instruction chung cho cả REST và SSE Triage */
  private buildTriageSystemInstruction(
    specialtiesContext: Array<{ code: string; name: string }>,
    clinicContext?: {
      branches: Array<{ name: string; address?: string | null; phoneNumber?: string | null }>
      specialties: Array<{ name: string; description?: string | null }>
    },
  ) {
    const availableCodes = specialtiesContext.map((s) => `${s.code} (${s.name})`).join(', ')
    const branchListStr = (clinicContext?.branches || [])
      .map((b, i) => `Cơ sở ${i + 1}: ${b.name} - Địa chỉ: ${b.address || 'Đang cập nhật'} (Hotline: ${b.phoneNumber || '0767 305 619'})`)
      .join('\n')
    const specialtyListStr = (clinicContext?.specialties || specialtiesContext).map((s) => s.name).join(', ')

    return `Bạn là Trợ lý Y tế & Tư vấn Dịch vụ Thông minh của Hệ thống Phòng khám Đa khoa VitaCare.
Thông tin thực tế của Phòng khám VitaCare:
- Danh sách Chi nhánh / Cơ sở:
${branchListStr || 'Cơ sở chính VitaCare: 123 Nguyễn Văn Cừ, Quận 5, TP.HCM'}
- Tổng số chuyên khoa hiện có: ${(clinicContext?.specialties || specialtiesContext).length} chuyên khoa (${specialtyListStr})
- Giờ làm việc: 07:00 - 20:00 tất cả các ngày trong tuần.
- Hotline hỗ trợ: 0767 305 619

Nhiệm vụ:
1. Giải đáp chính xác thông tin phòng khám, chi nhánh, chuyên khoa, hotline, đặt lịch.
2. Lắng nghe và phân tích triệu chứng ân cần. Tuyệt đối KHÔNG khẳng định chẩn đoán.
3. Tuyệt đối KHÔNG kê đơn thuốc kháng sinh hay thuốc đặc trị.
4. Phát hiện dấu hiệu cấp cứu nguy hiểm.
5. Khớp 1 đến 2 mã chuyên khoa phù hợp nhất từ danh sách: [${availableCodes}].
6. ĐỊNH DẠNG VĂN BẢN:
   - TUYỆT ĐỐI KHÔNG dùng ký tự markdown '**' hoặc '*' để in đậm trong câu trả lời.
   - Viết câu chữ tự nhiên, mạch lạc, dùng dấu gạch đầu dòng '-' thay vì dùng ký hiệu '**'.`
  }

  private async generateMedicalTriage(
    sanitizedQuery: string,
    specialtiesContext: Array<{ code: string; name: string }>,
    clinicContext?: {
      branches: Array<{ name: string; address?: string | null; phoneNumber?: string | null }>
      specialties: Array<{ name: string; description?: string | null }>
    },
  ): Promise<StructuredAiTriageResponse> {
    const isLocalEmergency = this.emergencyKeywords.some((kw) => sanitizedQuery.toLowerCase().includes(kw))

    if (this.aiClient) {
      try {
        const systemInstruction = this.buildTriageSystemInstruction(specialtiesContext, clinicContext)
        const apiPromise = this.aiClient.models.generateContent({
          model: this.modelName,
          contents: sanitizedQuery,
          config: {
            systemInstruction,
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                possibleCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
                careAdvice: { type: Type.ARRAY, items: { type: Type.STRING } },
                isEmergency: { type: Type.BOOLEAN },
                emergencyReason: { type: Type.STRING },
                recommendedSpecialtyCodes: { type: Type.ARRAY, items: { type: Type.STRING } },
                confidenceScore: { type: Type.NUMBER },
                disclaimer: { type: Type.STRING },
              },
              required: ['summary', 'possibleCauses', 'careAdvice', 'isEmergency', 'recommendedSpecialtyCodes', 'disclaimer'],
            },
          },
        })

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API timeout')), 10000),
        )
        const response: any = await Promise.race([apiPromise, timeoutPromise])
        return this.filterRxViolations(JSON.parse(response.text), isLocalEmergency)
      } catch (err: any) {
        this.logger.warn(`Gemini API error (${err?.message}). Sử dụng Rule-based Smart Triage.`)
      }
    }

    return this.ruleBasedTriage(sanitizedQuery, specialtiesContext, isLocalEmergency)
  }

  private async streamMedicalTriage(
    sanitizedQuery: string,
    specialtiesContext: Array<{ code: string; name: string }>,
    onToken: (token: string) => void,
    clinicContext?: {
      branches: Array<{ name: string; address?: string | null; phoneNumber?: string | null }>
      specialties: Array<{ name: string; description?: string | null }>
    },
  ): Promise<StructuredAiTriageResponse> {
    const isLocalEmergency = this.emergencyKeywords.some((kw) => sanitizedQuery.toLowerCase().includes(kw))

    if (this.aiClient) {
      try {
        const systemInstruction = this.buildTriageSystemInstruction(specialtiesContext, clinicContext)
        const stream = await this.aiClient.models.generateContentStream({
          model: this.modelName,
          contents: sanitizedQuery,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        })

        let accumulated = ''
        for await (const chunk of stream) {
          const text = chunk.text || ''
          if (text) {
            accumulated += text
            onToken(text)
          }
        }
        return this.filterRxViolations(JSON.parse(accumulated), isLocalEmergency)
      } catch (err: any) {
        this.logger.warn(`Native SSE stream error (${err?.message}). Sử dụng Rule-based Smart Triage.`)
      }
    }

    const fullTriage = this.ruleBasedTriage(sanitizedQuery, specialtiesContext, isLocalEmergency)
    onToken(fullTriage.summary)
    return fullTriage
  }

  private filterRxViolations(triage: StructuredAiTriageResponse, isLocalEmergency: boolean): StructuredAiTriageResponse {
    let sanitizedSummary = triage.summary
    for (const regex of this.rxBlacklist) {
      if (regex.test(sanitizedSummary)) {
        sanitizedSummary = sanitizedSummary.replace(regex, '[Thuốc kê đơn cần bác sĩ chỉ định]')
      }
    }
    const cleanAdvice = (triage.careAdvice || []).map((advice) => {
      let cleaned = advice
      for (const regex of this.rxBlacklist) {
        cleaned = cleaned.replace(regex, '[Thuốc kê đơn]')
      }
      return cleaned
    })

    return {
      ...triage,
      summary: sanitizedSummary,
      careAdvice: cleanAdvice,
      isEmergency: isLocalEmergency ? true : triage.isEmergency,
      disclaimer: 'Lưu ý y tế: Phân tích của AI chỉ mang tính tham khảo và hỗ trợ định hướng. Không thay thế chẩn đoán của Bác sĩ.',
    }
  }

  private ruleBasedTriage(
    query: string,
    specialtiesContext: Array<{ code: string; name: string }>,
    isEmergency: boolean,
  ): StructuredAiTriageResponse {
    const lower = query.toLowerCase()
    const matchedCodes: string[] = []

    if (lower.includes('tim') || lower.includes('ngực') || lower.includes('huyết áp')) {
      const spec = specialtiesContext.find((s) => s.code.toLowerCase().includes('tim') || s.name.toLowerCase().includes('tim'))
      if (spec) matchedCodes.push(spec.code)
    }
    if (lower.includes('tai') || lower.includes('mũi') || lower.includes('họng') || lower.includes('viêm xoang') || lower.includes('ho')) {
      const spec = specialtiesContext.find((s) => s.code.toLowerCase().includes('tai') || s.name.toLowerCase().includes('tai'))
      if (spec) matchedCodes.push(spec.code)
    }
    if (lower.includes('mắt') || lower.includes('nhìn mờ')) {
      const spec = specialtiesContext.find((s) => s.code.toLowerCase().includes('mat') || s.name.toLowerCase().includes('mắt'))
      if (spec) matchedCodes.push(spec.code)
    }
    if (lower.includes('da') || lower.includes('ngứa') || lower.includes('mụn') || lower.includes('dị ứng')) {
      const spec = specialtiesContext.find((s) => s.code.toLowerCase().includes('da') || s.name.toLowerCase().includes('da'))
      if (spec) matchedCodes.push(spec.code)
    }
    if (lower.includes('khớp') || lower.includes('xương') || lower.includes('lưng') || lower.includes('gối')) {
      const spec = specialtiesContext.find((s) => s.code.toLowerCase().includes('xuong') || s.name.toLowerCase().includes('xương') || s.name.toLowerCase().includes('khớp'))
      if (spec) matchedCodes.push(spec.code)
    }

    if (matchedCodes.length === 0 && specialtiesContext.length > 0) {
      matchedCodes.push(specialtiesContext[0].code)
    }

    return {
      summary: `Hệ thống ghi nhận triệu chứng: "${query}". Dựa trên dấu hiệu mô tả, bạn nên đặt lịch khám chuyên khoa để được bác sĩ thăm khám cụ thể.`,
      possibleCauses: ['Phản ứng cơ địa thông thường', 'Tổn thương chức năng cần kiểm tra cận lâm sàng'],
      careAdvice: ['Nghỉ ngơi hợp lý, tránh vận động gắng sức', 'Uống đủ nước, theo dõi sát diễn tiến triệu chứng', 'Đến cơ sở y tế gần nhất nếu có dấu hiệu nặng lên'],
      isEmergency,
      emergencyReason: isEmergency ? 'Phát hiện dấu hiệu cấp cứu y tế cần can thiệp khẩn cấp' : undefined,
      recommendedSpecialtyCodes: matchedCodes,
      confidenceScore: 0.8,
      disclaimer: 'Lưu ý: Đánh giá phân luồng của hệ thống chỉ mang tính định hướng ban đầu, không thay thế chẩn đoán trực tiếp của bác sĩ.',
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 8. HELPER: LƯU TRỮ HỘI THOẠI (PERSISTENCE)
  // ═════════════════════════════════════════════════════════════
  private async persistConversation(
    sessionId: string,
    userId: string | undefined,
    sanitizedText: string,
    rawMessage: string,
    triage: any,
    recommendations: any,
    dto: AiChatMessageDto,
  ) {
    try {
      const p = this.prisma as any
      if (!p.aIConversation && !p.aiConversation) return

      const convDelegate = p.aIConversation || p.aiConversation
      const msgDelegate = p.aIMessage || p.aiMessage
      const insightDelegate = p.aITriageInsight || p.aiTriageInsight

      let conversation = await convDelegate.findFirst({ where: { id: sessionId } })
      if (!conversation) {
        conversation = await convDelegate.create({
          data: {
            id: sessionId,
            userId,
            title: sanitizedText.slice(0, 100),
            conversationType: 'TRIAGE_CONSULTATION',
            isClosed: false,
          },
        })
      }

      await msgDelegate.create({
        data: { conversationId: conversation.id, sender: 'USER', content: sanitizedText, tokensUsed: 0 },
      })
      await msgDelegate.create({
        data: {
          conversationId: conversation.id,
          sender: 'ASSISTANT',
          content: triage.summary,
          structuredResponse: { triage, recommendations } as any,
          tokensUsed: Math.ceil((rawMessage.length + triage.summary.length) / 4),
        },
      })
      await insightDelegate.create({
        data: {
          conversationId: conversation.id,
          extractedSymptoms: sanitizedText,
          preliminaryDiagnosis: (triage.possibleCauses || []).join('; '),
          confidenceScore: triage.confidenceScore || 0.85,
          userLatitude: dto.userLocationLat,
          userLongitude: dto.userLocationLng,
          suggestedSpecialtyId: recommendations.specialties[0] ? Number(recommendations.specialties[0].id) : undefined,
          suggestedDoctorId: recommendations.doctors[0] ? recommendations.doctors[0].id : undefined,
        },
      })
    } catch (dbErr: any) {
      this.logger.warn(`Không thể lưu hội thoại AI vào DB: ${dbErr?.message}`)
    }
  }
}
