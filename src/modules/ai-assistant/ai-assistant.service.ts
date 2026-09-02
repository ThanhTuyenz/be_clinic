import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import type { Response } from 'express'
import { GoogleGenAI, Type } from '@google/genai'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { BookingService } from '../appointments/booking.service.js'
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

  // Định nghĩa Native Tools cho Gemini Function Calling
  private readonly agentTools = [
    {
      functionDeclarations: [
        {
          name: 'searchAvailableDoctorSlots',
          description:
            'Tra cứu ca khám và khung giờ còn trống thực tế của bác sĩ trong hệ thống phòng khám VitaCare.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              specialtyName: {
                type: Type.STRING,
                description:
                  'Tên chuyên khoa hoặc nhóm bệnh lý (ví dụ: Tai Mũi Họng, Mắt, Tim mạch, Tiêu hóa, Nhi khoa, Cơ xương khớp, Nội tổng quát)',
              },
              branchName: {
                type: Type.STRING,
                description:
                  'Tên cơ sở phòng khám mong muốn (ví dụ: "Cơ sở 1", "Cơ sở 2", "Quận 5", "Quận 7")',
              },
              targetDate: {
                type: Type.STRING,
                description:
                  'Ngày khám mong muốn theo định dạng YYYY-MM-DD (ví dụ: "2026-09-03")',
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
            'Tra cứu danh sách các gói khám sức khỏe định kỳ, gói tầm soát bệnh lý hoặc gói dịch vụ y tế trọn gói.',
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
          parameters: {
            type: Type.OBJECT,
            properties: {},
          },
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

    const [specialtiesContext, clinicContext] = await Promise.all([
      this.getActiveSpecialtiesContext(),
      this.getClinicInformationContext(),
    ])

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

      const [specialtiesContext, clinicContext] = await Promise.all([
        this.getActiveSpecialtiesContext(),
        this.getClinicInformationContext(),
      ])

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

    // E. Gọi Gemini Agentic Loop với Native Function Calling
    if (this.aiClient) {
      try {
        const todayStr = new Date().toLocaleDateString('vi-VN', {
          weekday: 'long',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
        })

        const systemInstruction = `Bạn là Trợ lý AI Đặt lịch khám bệnh & Điều phối Y tế (AI Booking Agent) của Hệ thống Phòng khám Đa khoa VitaCare.
Hôm nay là: ${todayStr}.
Các cơ sở VitaCare:
- Cơ sở 1: VitaCare Quận 5 (123 Nguyễn Tri Phương, Phường 7, Quận 5, TP.HCM)
- Cơ sở 2: VitaCare Quận 7 (456 Nguyễn Thị Thập, Phường Tân Phong, Quận 7, TP.HCM)

Quy tắc & công cụ (Tools):
1. Khi người dùng muốn ĐẶT LỊCH BÁC SĨ hoặc mô tả triệu chứng muốn khám:
   - Bạn cần biết tối thiểu: Chuyên khoa (hoặc bệnh gì), Cơ sở (CS1 hoặc CS2), và Ngày khám (định dạng YYYY-MM-DD).
   - Nếu THIẾU Cơ sở hoặc Ngày khám: Hãy hỏi người bệnh bằng ngôn ngữ tự nhiên, ân cần, lịch sự (Ví dụ: "Dạ bạn muốn khám tại Cơ sở 1 (Quận 5) hay Cơ sở 2 (Quận 7), và bạn tiện đi khám vào ngày nào ạ?").
   - Khi ĐÃ ĐỦ Chuyên khoa, Cơ sở và Ngày: Hãy lập tức GỌI CÔNG CỤ "searchAvailableDoctorSlots" để kiểm tra lịch trống thực tế!
2. Khi người dùng muốn TÌM GÓI KHÁM / GÓI TẦM SOÁT:
   - Hãy GỌI CÔNG CỤ "searchServicePackages" với từ khóa phù hợp.
3. Khi nhận được kết quả từ công cụ:
   - Hãy giới thiệu tóm tắt ca khám hoặc các gói khám cho bệnh nhân một cách thân thiện, chu đáo.
4. Tuyệt đối không tự ý kê đơn thuốc hoặc chẩn đoán khẳng định bệnh lý.`

        const response = await this.aiClient.models.generateContent({
          model: this.modelName,
          contents: session.history,
          config: {
            systemInstruction,
            tools: this.agentTools,
            temperature: 0.2,
          },
        })

        const functionCalls = response.functionCalls
        if (functionCalls && functionCalls.length > 0) {
          const call = functionCalls[0]
          let toolResult: any = null
          let proposal: AiAgentBookingProposal | null = null
          let proposedPackages: PackageCardRecommendation[] | undefined

          if (call.name === 'searchAvailableDoctorSlots') {
            toolResult = await this.executeSearchDoctorSlots(call.args as any)
            if (toolResult.found && toolResult.slot) {
              const s = toolResult.slot
              proposal = {
                slotId: s.id,
                doctorId: s.doctorId,
                doctorName: s.doctorName,
                specialtyName: s.specialtyName,
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
          }

          // Gửi kết quả Tool ngược lại vào history để Gemini sinh câu trả lời tự nhiên
          session.history.push({
            role: 'model',
            parts: [{ functionCall: call }],
          })
          session.history.push({
            role: 'user',
            parts: [{ functionResponse: { name: call.name, response: toolResult } }],
          })

          const finalRes = await this.aiClient.models.generateContent({
            model: this.modelName,
            contents: session.history,
            config: {
              systemInstruction,
              tools: this.agentTools,
            },
          })

          const finalText = finalRes.text || (proposal ? 'Tôi đã tìm thấy ca khám phù hợp cho bạn:' : 'Dưới đây là thông tin bạn cần:')
          session.history.push({
            role: 'model',
            parts: [{ text: finalText }],
          })

          if (proposal) {
            return {
              sessionId,
              step: 'PROPOSED',
              message: finalText,
              proposal,
              availableProfiles,
            }
          }

          if (proposedPackages && proposedPackages.length > 0) {
            return {
              sessionId,
              step: 'PROPOSED',
              message: finalText,
              proposal: null,
              proposedPackages,
              availableProfiles,
            }
          }

          return {
            sessionId,
            step: 'COLLECTING_INFO',
            message: finalText,
            proposal: null,
            availableProfiles,
          }
        }

        // Nếu Gemini không gọi tool (đang hỏi bổ sung hoặc trò chuyện)
        const replyText = response.text || 'Bạn có thể cung cấp thêm thông tin về chuyên khoa, cơ sở hoặc thời gian bạn muốn khám không ạ?'
        session.history.push({
          role: 'model',
          parts: [{ text: replyText }],
        })

        // Tạo quickSuggestions thông minh
        const quickSuggestions: string[] = []
        const rLower = replyText.toLowerCase()
        if (rLower.includes('cơ sở') || rLower.includes('chi nhánh') || rLower.includes('ở đâu')) {
          quickSuggestions.push('Cơ sở 1 (Quận 5)', 'Cơ sở 2 (Quận 7)')
        }
        if (rLower.includes('ngày') || rLower.includes('khi nào') || rLower.includes('thời gian') || rLower.includes('giờ')) {
          quickSuggestions.push('Sáng mai', 'Chiều mai', 'Sáng thứ Bảy', 'Chủ nhật')
        }
        if (rLower.includes('chuyên khoa') || rLower.includes('khám gì') || rLower.includes('triệu chứng')) {
          quickSuggestions.push('Tai Mũi Họng', 'Mắt', 'Tim mạch', 'Tiêu hóa', 'Khám tổng quát')
        }

        return {
          sessionId,
          step: 'COLLECTING_INFO',
          message: replyText,
          proposal: null,
          quickSuggestions: quickSuggestions.length > 0 ? quickSuggestions : undefined,
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
    branchName?: string
    targetDate: string
    period?: string
  }) {
    const [specialties, branches] = await Promise.all([
      this.prisma.specialty.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true } }),
      this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true, address: true } }),
    ])

    let targetSpecialty = specialties.find(
      (s) =>
        s.name.toLowerCase().includes(args.specialtyName.toLowerCase()) ||
        args.specialtyName.toLowerCase().includes(s.name.toLowerCase()),
    )
    if (!targetSpecialty) {
      const criteria = this.ruleBasedExtractCriteria(args.specialtyName, specialties, branches)
      if (criteria.specialtyId) {
        targetSpecialty = specialties.find((s) => s.id === criteria.specialtyId)
      }
    }

    let targetBranch: any = null
    if (args.branchName) {
      const bLower = args.branchName.toLowerCase()
      targetBranch = branches.find(
        (b) =>
          b.name.toLowerCase().includes(bLower) ||
          b.address.toLowerCase().includes(bLower) ||
          (bLower.includes('1') && b.name.includes('1')) ||
          (bLower.includes('2') && b.name.includes('2')) ||
          (bLower.includes('5') && b.address.includes('5')) ||
          (bLower.includes('7') && b.address.includes('7')),
      )
    }

    const dateObj = new Date(args.targetDate)
    const slot = await this.findAvailableSlotsForAgent({
      specialtyId: targetSpecialty?.id,
      branchId: targetBranch?.id,
      targetDate: isNaN(dateObj.getTime()) ? new Date() : dateObj,
      period: (args.period as any) || 'ALL',
    })

    if (!slot) {
      return {
        found: false,
        message: `Không có ca khám trống cho chuyên khoa ${targetSpecialty?.name || args.specialtyName} tại ${targetBranch?.name || 'phòng khám'} vào ngày ${args.targetDate}.`,
      }
    }

    return {
      found: true,
      slot: {
        id: slot.id,
        doctorId: slot.schedule.doctorId,
        doctorName: slot.schedule.doctor.user?.fullName
          ? `${slot.schedule.doctor.academicRank ? slot.schedule.doctor.academicRank + ' ' : ''}${slot.schedule.doctor.user.fullName}`.trim()
          : 'Bác sĩ chuyên khoa',
        specialtyName: slot.schedule.doctor.specialties?.[0]?.specialty?.name || targetSpecialty?.name || 'Khám chuyên khoa',
        branchId: slot.schedule.branchId,
        branchName: slot.schedule.branch?.name || 'VitaCare Clinic',
        date: slot.schedule.workDate.toISOString().slice(0, 10),
        startTime: slot.startTime.toISOString().slice(11, 16),
        endTime: slot.endTime.toISOString().slice(11, 16),
        fee: Number(slot.schedule.doctor.consultationFee || 200000),
      },
    }
  }

  private async executeSearchServicePackages(args: { keyword: string; specialtyName?: string }) {
    const kw = args.keyword.trim().toLowerCase()
    const packages = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: kw, mode: 'insensitive' } },
          { description: { contains: kw, mode: 'insensitive' } },
          { specialty: { name: { contains: kw, mode: 'insensitive' } } },
        ],
      },
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
    const [specialties, branches] = await Promise.all([
      this.prisma.specialty.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true } }),
      this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    ])

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

    const proposal: AiAgentBookingProposal = {
      slotId: bestSlot.id,
      doctorId: bestSlot.schedule.doctorId,
      doctorName: bestSlot.schedule.doctor.user?.fullName || 'Bác sĩ chuyên khoa',
      specialtyName: bestSlot.schedule.doctor.specialties?.[0]?.specialty?.name || 'Khám chuyên khoa',
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
      message: `Tôi đã tìm thấy lịch khám phù hợp cho bạn tại ${proposal.branchName}. Bạn có muốn xác nhận đặt lịch không?`,
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
      const checkoutResult = await this.bookingService.checkout(userId, {
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
      return {
        sessionId,
        step: 'ERROR',
        message: `Không thể hoàn tất đặt lịch: ${err?.message || 'Khung giờ có thể vừa hết chỗ'}. Vui lòng thử lại.`,
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
  private async getActiveSpecialtiesContext(): Promise<Array<{ id: string; code: string; name: string }>> {
    const specialties = await this.prisma.specialty.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true },
      orderBy: { sortOrder: 'asc' },
    })
    return specialties.map((s) => ({
      id: String(s.id),
      code: s.slug || String(s.id),
      name: s.name,
    }))
  }

  private async getClinicInformationContext() {
    const [branches, specialties] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true },
        select: { name: true, address: true, phoneNumber: true },
      }),
      this.prisma.specialty.findMany({
        where: { isActive: true },
        select: { name: true, description: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ])
    return { branches, specialties }
  }

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
    const fromDate = new Date(Date.UTC(criteria.targetDate.getFullYear(), criteria.targetDate.getMonth(), criteria.targetDate.getDate(), 0, 0, 0))
    const toDate = new Date(fromDate)
    toDate.setDate(toDate.getDate() + 7)

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
      take: 20,
    })

    const available = slots.filter((s) => s.occupiedCount < s.capacity)
    if (available.length === 0) return null

    if (criteria.period === 'MORNING') {
      const morningSlot = available.find((s) => s.startTime.getUTCHours() < 12)
      if (morningSlot) return morningSlot
    } else if (criteria.period === 'AFTERNOON') {
      const afternoonSlot = available.find((s) => s.startTime.getUTCHours() >= 12)
      if (afternoonSlot) return afternoonSlot
    }

  }

  private ruleBasedExtractCriteria(text: string, specialties: any[], branches: any[]) {
    const lower = text.toLowerCase()

    let specialtyId: number | undefined
    for (const spec of specialties) {
      if (lower.includes(spec.name.toLowerCase())) {
        specialtyId = spec.id
        break
      }
    }

    if (!specialtyId) {
      if (lower.includes('tim') || lower.includes('mạch') || lower.includes('huyết áp') || lower.includes('tức ngực') || lower.includes('hồi hộp') || lower.includes('loạn nhịp')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('tim'))?.id
      } else if (lower.includes('tiêu hóa') || lower.includes('gan') || lower.includes('mật') || lower.includes('dạ dày') || lower.includes('bao tử') || lower.includes('đau bụng') || lower.includes('trào ngược') || lower.includes('ợ chua') || lower.includes('nôn') || lower.includes('đại tràng') || lower.includes('tiêu chảy') || lower.includes('táo bón')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('tiêu hóa') || s.name.toLowerCase().includes('gan'))?.id
      } else if (lower.includes('hô hấp') || lower.includes('phổi') || lower.includes('phế quản') || lower.includes('hen') || lower.includes('suyễn') || lower.includes('khó thở') || lower.includes('thở rít')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('hô hấp'))?.id
      } else if (lower.includes('tai') || lower.includes('mũi') || lower.includes('họng') || lower.includes('viêm xoang') || lower.includes('amidan') || lower.includes('ù tai') || lower.includes('đau họng') || lower.includes('khản tiếng') || lower.includes('sổ mũi') || lower.includes('nghẹt mũi') || lower.includes('ho')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('tai'))?.id
      } else if (lower.includes('thần kinh') || lower.includes('đau đầu') || lower.includes('nhức đầu') || lower.includes('chóng mặt') || lower.includes('tiền đình') || lower.includes('mất ngủ') || lower.includes('khó ngủ') || lower.includes('tê bì') || lower.includes('trí nhớ')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('thần kinh'))?.id
      } else if (lower.includes('khớp') || lower.includes('xương') || lower.includes('lưng') || lower.includes('cột sống') || lower.includes('gối') || lower.includes('thoái hóa') || lower.includes('thoát vị') || lower.includes('chấn thương') || lower.includes('gãy') || lower.includes('trật')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('chấn thương') || s.name.toLowerCase().includes('xương') || s.name.toLowerCase().includes('khớp'))?.id
      } else if (lower.includes('mắt') || lower.includes('nhìn mờ') || lower.includes('mỏi mắt') || lower.includes('cận thị') || lower.includes('đau mắt') || lower.includes('đỏ mắt') || lower.includes('kết mạc') || lower.includes('thị lực')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('mắt'))?.id
      } else if (lower.includes('răng') || lower.includes('hàm') || lower.includes('nhổ răng') || lower.includes('sâu răng') || lower.includes('đau răng') || lower.includes('trám răng') || lower.includes('cao răng') || lower.includes('viêm lợi')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('răng'))?.id
      } else if (lower.includes('da') || lower.includes('mụn') || lower.includes('ngứa') || lower.includes('mề đay') || lower.includes('dị ứng') || lower.includes('vảy nến') || lower.includes('phát ban') || lower.includes('nấm')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('da'))?.id
      } else if (lower.includes('nhi') || lower.includes('bé') || lower.includes('trẻ em') || lower.includes('sơ sinh') || lower.includes('con tôi') || lower.includes('biếng ăn')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('nhi'))?.id
      } else if (lower.includes('sản') || lower.includes('phụ') || lower.includes('mang thai') || lower.includes('bầu') || lower.includes('chậm kinh') || lower.includes('trễ kinh') || lower.includes('khí hư')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('phụ') || s.name.toLowerCase().includes('sản'))?.id
      } else if (lower.includes('tiểu đường') || lower.includes('đái tháo đường') || lower.includes('đường huyết') || lower.includes('tuyến giáp') || lower.includes('bướu cổ')) {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('nội tiết'))?.id
      } else {
        specialtyId = specialties.find(s => s.name.toLowerCase().includes('nội tổng quát') || s.name.toLowerCase().includes('tổng quát'))?.id || specialties[0]?.id
      }
    }

    let branchId: string | undefined
    for (const b of branches) {
      if (lower.includes(b.name.toLowerCase())) {
        branchId = b.id
        break
      }
    }
    if (!branchId) {
      if (lower.includes('cơ sở 1') || lower.includes('cs1') || lower.includes('quận 5') || lower.includes('trung tâm')) branchId = branches[0]?.id
      else if (lower.includes('cơ sở 2') || lower.includes('cs2') || lower.includes('quận 7')) branchId = branches[1]?.id
    }

    let period: 'MORNING' | 'AFTERNOON' | 'ALL' = 'ALL'
    if (lower.includes('sáng')) period = 'MORNING'
    else if (lower.includes('chiều') || lower.includes('tối')) period = 'AFTERNOON'

    return { specialtyId, branchId, period }
  }

  private matchProfileFromText(text: string, profiles: Array<{ id: string; fullName: string; relationship: string }>) {
    const lower = text.toLowerCase()
    for (const p of profiles) {
      if (lower.includes(p.fullName.toLowerCase())) return p
      if (p.relationship.toLowerCase() === 'mẹ' && (lower.includes('mẹ') || lower.includes('má'))) return p
      if (p.relationship.toLowerCase() === 'bố' && (lower.includes('bố') || lower.includes('ba') || lower.includes('cha'))) return p
      if (p.relationship.toLowerCase() === 'con' && (lower.includes('con') || lower.includes('bé'))) return p
      if (p.relationship.toLowerCase() === 'vợ' && lower.includes('vợ')) return p
      if (p.relationship.toLowerCase() === 'chồng' && lower.includes('chồng')) return p
    }
    return null
  }

  // ═════════════════════════════════════════════════════════════
  // 7. HELPER: GOOGLE GEMINI & RULE-BASED TRIAGE
  // ═════════════════════════════════════════════════════════════
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
        const availableCodes = specialtiesContext.map((s) => `${s.code} (${s.name})`).join(', ')
        const branchListStr = (clinicContext?.branches || [])
          .map((b, i) => `Cơ sở ${i + 1}: ${b.name} - Địa chỉ: ${b.address || 'Đang cập nhật'} (Hotline: ${b.phoneNumber || '0767 305 619'})`)
          .join('\n')
        const specialtyListStr = (clinicContext?.specialties || specialtiesContext).map((s) => s.name).join(', ')

        const systemInstruction = `Bạn là Trợ lý Y tế & Tư vấn Dịch vụ Thông minh của Hệ thống Phòng khám Đa khoa VitaCare.
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
5. Khớp 1 đến 2 mã chuyên khoa phù hợp nhất từ danh sách: [${availableCodes}].`

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
        const parsed = JSON.parse(response.text)
        return this.filterRxViolations(parsed, isLocalEmergency)
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
    clinicContext?: any,
  ): Promise<StructuredAiTriageResponse> {
    const isLocalEmergency = this.emergencyKeywords.some((kw) => sanitizedQuery.toLowerCase().includes(kw))

    if (this.aiClient) {
      try {
        const specSummary = specialtiesContext.map((s) => `${s.code}: ${s.name}`).join(', ')
        const clinicSummary = clinicContext?.branches
          ? clinicContext.branches.map((b: any) => `${b.name} (${b.address || ''})`).join('; ')
          : 'Hệ thống phòng khám VitaCare Clinic'

        const prompt = `Bạn là Trợ lý Sàng lọc Y tế & Điều hướng Đặt lịch (Medical Triage Assistant) của VitaCare Clinic.
Danh mục chuyên khoa: [${specSummary}].
Cơ sở phòng khám: [${clinicSummary}].
Người bệnh mô tả: "${sanitizedQuery}".
Phân tích và trả về duy nhất định dạng JSON chuẩn:
{
  "summary": "Tóm tắt ngắn gọn và phân tích triệu chứng (tối đa 4 câu)",
  "recommendedSpecialtyCodes": ["MÃ_CHUYÊN_KHOA_PHÙ_HỢP"],
  "urgencyLevel": "LOW" | "MEDIUM" | "HIGH" | "EMERGENCY",
  "isEmergency": boolean,
  "careAdvice": ["Lời khuyên chăm sóc tạm thời 1", "Lời khuyên 2"],
  "disclaimer": "Lưu ý y tế: Phân tích của AI chỉ mang tính tham khảo và hỗ trợ định hướng. Không thay thế chẩn đoán của Bác sĩ."
}`

        const stream = await this.aiClient.models.generateContentStream({
          model: this.modelName,
          contents: prompt,
          config: {
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

        const parsed: StructuredAiTriageResponse = JSON.parse(accumulated)
        return this.filterRxViolations(parsed, isLocalEmergency)
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
