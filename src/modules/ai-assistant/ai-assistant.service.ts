import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type { Response } from 'express'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { PiiSanitizerService } from './services/pii-sanitizer.service.js'
import { GeminiLlmService } from './services/gemini-llm.service.js'
import { DeterministicClinicalService } from './services/deterministic-clinical.service.js'
import { AiChatMessageDto, AiChatResponsePayload } from './dtos/ai-chat.dto.js'

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly piiSanitizer: PiiSanitizerService,
    private readonly geminiLlm: GeminiLlmService,
    private readonly deterministicClinical: DeterministicClinicalService,
  ) {}

  /**
   * 1. Xử lý chuẩn REST
   */
  async processUserMessage(dto: AiChatMessageDto, currentUserId?: string): Promise<AiChatResponsePayload> {
    const sessionId = dto.sessionId || randomUUID()

    // TẦNG 1 & 2: Khử định danh PII & Chống Prompt Injection
    const { sanitizedText, hasRedactions } = this.piiSanitizer.sanitizeInput(dto.message)
    if (hasRedactions) {
      this.logger.log(`Session ${sessionId}: Đã khử định danh thông tin cá nhân trong tin nhắn.`)
    }

    // Lấy context các chuyên khoa & thông tin chung phòng khám
    const [specialtiesContext, clinicContext] = await Promise.all([
      this.deterministicClinical.getActiveSpecialtiesContext(),
      this.deterministicClinical.getClinicInformationContext(),
    ])

    // TẦNG 3 & 4: Gọi Cloud LLM với JSON Schema & Output Sanitizer
    const triage = await this.geminiLlm.generateMedicalTriage(sanitizedText, specialtiesContext, clinicContext)

    // TẦNG 5: Deterministic Internal Service - Lấy danh sách thực từ PostgreSQL
    const recommendations = await this.deterministicClinical.getClinicalRecommendations(
      triage.recommendedSpecialtyCodes,
    )

    // LƯU TRỮ VÀO CƠ SỞ DỮ LIỆU
    await this.persistConversation(sessionId, currentUserId, sanitizedText, dto.message, triage, recommendations, dto)

    return {
      sessionId,
      sanitizedQuery: sanitizedText,
      triage,
      recommendations,
    }
  }

  /**
   * 2. Xử lý chuẩn SSE Stream (Server-Sent Events)
   */
  async processUserMessageStream(dto: AiChatMessageDto, res: Response, currentUserId?: string): Promise<void> {
    const sessionId = dto.sessionId || randomUUID()

    // Thiết lập Header SSE
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      // TẦNG 1 & 2: Khử định danh PII
      const { sanitizedText } = this.piiSanitizer.sanitizeInput(dto.message)
      sendEvent('pii_sanitized', { sessionId, sanitizedText })

      // Context chuyên khoa & thông tin phòng khám
      const [specialtiesContext, clinicContext] = await Promise.all([
        this.deterministicClinical.getActiveSpecialtiesContext(),
        this.deterministicClinical.getClinicInformationContext(),
      ])

      // TẦNG 3 & 4: Stream Token từng chữ một
      const triage = await this.geminiLlm.streamMedicalTriage(
        sanitizedText,
        specialtiesContext,
        (token) => {
          sendEvent('token', { token })
        },
        clinicContext,
      )


      // TẦNG 5: Deterministic Recommendations từ PostgreSQL
      const recommendations = await this.deterministicClinical.getClinicalRecommendations(
        triage.recommendedSpecialtyCodes,
      )
      sendEvent('recommendations', { recommendations, triage })

      // Lưu Database
      await this.persistConversation(sessionId, currentUserId, sanitizedText, dto.message, triage, recommendations, dto)

      sendEvent('done', { sessionId })
    } catch (err: any) {
      this.logger.error(`Lỗi khi stream SSE: ${err?.message}`)
      sendEvent('error', { message: 'Đã xảy ra lỗi khi xử lý luồng AI stream.' })
    } finally {
      res.end()
    }
  }

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

      let conversation = await convDelegate.findFirst({
        where: { id: sessionId },
      })

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
        data: {
          conversationId: conversation.id,
          sender: 'USER',
          content: sanitizedText,
          tokensUsed: 0,
        },
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
