import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenAI, Type } from '@google/genai'
import { StructuredAiTriageResponse } from '../dtos/ai-chat.dto.js'

@Injectable()
export class GeminiLlmService {
  private readonly logger = new Logger(GeminiLlmService.name)
  private aiClient: GoogleGenAI | null = null

  // Tầng 4: Danh sách tên thuốc kê đơn / kháng sinh cần chặn (Rx Blacklist)
  private readonly rxBlacklist = [
    /\b(amoxicillin|augmentin|azithromycin|ciprofloxacin|cefixime|cephalexin|levofloxacin|clarithromycin)\b/gi,
    /\b(morphine|tramadol|codeine|fentanyl|diazepam|seduxen|alprazolam|lorazepam)\b/gi,
    /\b(prednisolone|dexamethasone|methylprednisolone)\b/gi,
    /\b(metformin|insulin|glimepiride|losartan|amlodipine|atorvastatin)\b/gi,
  ]

  // Từ khóa dấu hiệu cấp cứu y khoa (Emergency Red Flags)
  private readonly emergencyKeywords = [
    'ngực dữ dội',
    'khó thở cấp',
    'vã mồ hôi lạnh',
    'méo miệng',
    'liệt nửa người',
    'nói đớ',
    'co giật',
    'nôn ra máu',
    'ngất xỉu',
    'bất tỉnh',
    'đau đầu sét đánh',
    'sốt cao co giật',
  ]

  private modelName: string = 'gemini-2.5-flash'

  constructor(private readonly configService: ConfigService) {
    const geminiConfig = this.configService.get<{ apiKey?: string; model?: string }>('gemini')
    const apiKey = geminiConfig?.apiKey || this.configService.get<string>('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (geminiConfig?.model) {
      this.modelName = geminiConfig.model
    }

    if (apiKey) {
      this.aiClient = new GoogleGenAI({ apiKey })
      this.logger.log(`Đã khởi tạo Google Gemini AI Client thành công (Model: ${this.modelName}).`)
    } else {
      this.logger.warn('Chưa cấu hình GEMINI_API_KEY trong file .env. Hệ thống sẽ sử dụng Rule-based Smart Triage Engine dự phòng.')
    }
  }


  /**
   * Tầng 3: Gọi Google Gemini với Structured Output (JSON Schema)
   */
  async generateMedicalTriage(
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
        const specialtyListStr = (clinicContext?.specialties || specialtiesContext)
          .map((s) => s.name)
          .join(', ')

        const systemInstruction = `Bạn là Trợ lý Y tế & Tư vấn Dịch vụ Thông minh của Hệ thống Phòng khám Đa khoa VitaCare.
Thông tin thực tế của Phòng khám VitaCare:
- Danh sách Chi nhánh / Cơ sở:
${branchListStr || 'Cơ sở chính VitaCare: 123 Nguyễn Văn Cừ, Quận 5, TP.HCM'}
- Tổng số chuyên khoa hiện có: ${(clinicContext?.specialties || specialtiesContext).length} chuyên khoa (${specialtyListStr})
- Giờ làm việc: 07:00 - 20:00 tất cả các ngày trong tuần (kể cả Thứ Bảy, Chủ Nhật và ngày Lễ).
- Hotline hỗ trợ: 0767 305 619

Nhiệm vụ của bạn:
1. Giải đáp đầy đủ, chính xác mọi câu hỏi về: địa chỉ cơ sở, chi nhánh, hotline, số lượng và tên các chuyên khoa, quy trình đặt lịch và dịch vụ của phòng khám.
2. Lắng nghe và phân tích triệu chứng của người bệnh một cách ân cần, khoa học. Tuyệt đối KHÔNG đưa ra chẩn đoán khẳng định bệnh ("Bạn bị bệnh X"), chỉ phân tích các nhóm nguyên nhân thường gặp có thể nghĩ đến.
3. Tuyệt đối KHÔNG kê đơn thuốc kháng sinh hay thuốc điều trị đặc trị. Chỉ đưa ra lời khuyên chăm sóc ban đầu và chế độ sinh hoạt an toàn.
4. Xác định mức độ khẩn cấp (Emergency) nếu có dấu hiệu nguy hiểm (tim mạch, đột quỵ, khó thở cấp...).
5. Khớp ngữ cảnh và chọn 1 đến 2 mã chuyên khoa phù hợp nhất từ danh sách: [${availableCodes}]. Nếu người dùng chỉ hỏi thông tin chung phòng khám thì trả về danh sách chuyên khoa rỗng [] hoặc chuyên khoa liên quan.
6. Luôn cung cấp lời khuyên khách quan và tuyên bố miễn trừ trách nhiệm y tế.`

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
                summary: { type: Type.STRING, description: 'Câu trả lời chi tiết, ân cần cho câu hỏi hoặc phân tích triệu chứng' },
                possibleCauses: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Các nhóm nguyên nhân y khoa thường gặp (để trống nếu hỏi thông tin chung)',
                },
                careAdvice: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Lời khuyên chăm sóc sức khỏe hoặc hướng dẫn đặt khám',
                },
                isEmergency: { type: Type.BOOLEAN, description: 'true nếu có dấu hiệu cấp cứu cần đến viện ngay' },
                emergencyReason: { type: Type.STRING, description: 'Lý do cảnh báo cấp cứu nếu có' },
                recommendedSpecialtyCodes: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Mã chuyên khoa (code) đề xuất khám',
                },
                confidenceScore: { type: Type.NUMBER, description: 'Độ tự tin từ 0.0 đến 1.0' },
                disclaimer: { type: Type.STRING, description: 'Tuyên bố miễn trừ trách nhiệm' },
              },
              required: ['summary', 'possibleCauses', 'careAdvice', 'isEmergency', 'recommendedSpecialtyCodes', 'disclaimer'],
            },
          },
        })

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API call timed out after 8s')), 8000),
        )

        const response = (await Promise.race([apiPromise, timeoutPromise])) as any

        if (response.text) {
          const parsed = JSON.parse(response.text) as StructuredAiTriageResponse
          return this.sanitizeOutput(parsed, isLocalEmergency)
        }
      } catch (err: any) {
        this.logger.warn(`Lỗi/Timeout khi gọi Gemini API (${err?.message}). Chuyển sang Smart Rule-based Engine.`)
      }
    }

    // Fallback Rule-based engine
    return this.fallbackTriageEngine(sanitizedQuery, specialtiesContext, isLocalEmergency, clinicContext)
  }

  /**
   * Tầng 3 (Streaming): Stream nội dung theo thời gian thực (Server-Sent Events)
   */
  async streamMedicalTriage(
    sanitizedQuery: string,
    specialtiesContext: Array<{ code: string; name: string }>,
    onToken: (token: string) => void,
    clinicContext?: {
      branches: Array<{ name: string; address?: string | null; phoneNumber?: string | null }>
      specialties: Array<{ name: string; description?: string | null }>
    },
  ): Promise<StructuredAiTriageResponse> {
    const triage = await this.generateMedicalTriage(sanitizedQuery, specialtiesContext, clinicContext)

    // Stream phản hồi trực tiếp, súc tích và gãy gọn
    const fullText = triage.summary
    const words = fullText.split(' ')
    for (const word of words) {
      onToken(word + ' ')
      await new Promise((r) => setTimeout(r, 18))
    }

    return triage
  }


  /**
   * Tầng 4: Output Sanitizer & Hallucination Filter
   */
  private sanitizeOutput(triage: StructuredAiTriageResponse, isLocalEmergency: boolean): StructuredAiTriageResponse {
    let summary = triage.summary || ''
    let careAdvice = (triage.careAdvice || []).map((advice) => {
      let cleaned = advice
      for (const rx of this.rxBlacklist) {
        if (rx.test(cleaned)) {
          this.logger.warn(`Phát hiện tên thuốc kê đơn trong phản hồi của AI: ${cleaned}. Tiến hành che chắn.`)
          cleaned = cleaned.replace(rx, '[Thuốc kê đơn - Cần bác sĩ chỉ định trực tiếp]')
        }
      }
      return cleaned
    })

    const isEmergency = Boolean(triage.isEmergency || isLocalEmergency)
    const disclaimer = 'Thông tin tư vấn từ AI chỉ mang tính định hướng và sàng lọc ban đầu, không thay thế cho chẩn đoán và phác đồ điều trị của bác sĩ chuyên khoa tại cơ sở y tế.'

    return {
      ...triage,
      summary,
      careAdvice,
      isEmergency,
      emergencyReason: isEmergency ? (triage.emergencyReason || 'Triệu chứng có dấu hiệu khẩn cấp, vui lòng liên hệ 115 hoặc đến cơ sở y tế gần nhất!') : undefined,
      disclaimer,
    }
  }

  /**
   * Engine phân tích dự phòng thông minh (Rule-based Triage) khi chưa có API Key
   */
  private fallbackTriageEngine(
    text: string,
    specialties: Array<{ code: string; name: string }>,
    isEmergency: boolean,
    clinicContext?: {
      branches: Array<{ name: string; address?: string | null; phoneNumber?: string | null }>
      specialties: Array<{ name: string; description?: string | null }>
    },
  ): StructuredAiTriageResponse {
    const lower = text.toLowerCase()
    const disclaimer = 'Thông tin tư vấn từ AI chỉ mang tính định hướng và sàng lọc ban đầu, không thay thế cho chẩn đoán và phác đồ điều trị của bác sĩ chuyên khoa tại cơ sở y tế.'

    // 1. Câu hỏi về đặt lịch / chọn gói khám
    if (/đặt lịch|đặt gói|muốn khám|chọn gói|gói có giá|220|180|990/i.test(lower)) {
      return {
        summary: `Tôi đã hỗ trợ định vị gói khám và chuyên khoa phù hợp với nhu cầu của bạn. Bạn vui lòng bấm trực tiếp vào nút **Đặt khám** ngay ở thẻ bên dưới để chọn cơ sở, ngày giờ và xác nhận đặt lịch thuận tiện nhất nhé!`,
        possibleCauses: [],
        careAdvice: [
          'Chọn khung giờ khám mong muốn để được chuẩn bị hồ sơ đón tiếp trước',
          'Hotline hỗ trợ đặt khám nhanh 24/7: 0767 305 619',
        ],
        isEmergency: false,
        recommendedSpecialtyCodes: specialties.slice(0, 2).map((s) => s.code),
        confidenceScore: 0.98,
        disclaimer,
      }
    }

    // 2. Câu hỏi về địa chỉ / chi nhánh / cơ sở / ở đâu
    if (/địa chỉ|chi nhánh|cơ sở|ở đâu|vị trí|bệnh viện|phòng khám ở/i.test(lower)) {

      const branches = clinicContext?.branches?.length
        ? clinicContext.branches
        : [{ name: 'VitaCare Clinic - Cơ sở 1', address: '123 Nguyễn Văn Cừ, Phường 4, Quận 5, TP.HCM', phoneNumber: '0767 305 619' }]
      
      const branchSummary = branches
        .map((b, idx) => `📍 **${b.name}**: ${b.address || 'Trung tâm TP.HCM'} (Hotline: ${b.phoneNumber || '0767 305 619'})`)
        .join('\n\n')

      return {
        summary: `Hệ thống Phòng khám Đa khoa Quốc tế VitaCare hiện có các cơ sở phục vụ quý khách:\n\n${branchSummary}\n\n🕒 **Giờ làm việc:** 07:00 - 20:00 tất cả các ngày trong tuần (kể cả Thứ Bảy, Chủ Nhật và ngày Lễ).`,
        possibleCauses: [],
        careAdvice: [
          'Bạn có thể đến trực tiếp hoặc đặt lịch trước trên website để được ưu tiên lấy số thứ tự khám nhanh',
          'Hotline hỗ trợ 24/7: 0767 305 619',
        ],
        isEmergency: false,
        recommendedSpecialtyCodes: specialties.slice(0, 2).map((s) => s.code),
        confidenceScore: 0.95,
        disclaimer,
      }
    }

    // 2. Câu hỏi về chuyên khoa / có bao nhiêu chuyên khoa
    if (/chuyên khoa|bao nhiêu khoa|khoa nào|khám những gì|danh sách khoa/i.test(lower)) {
      const specList = (clinicContext?.specialties || specialties).map((s) => s.name).join(', ')
      const totalCount = (clinicContext?.specialties || specialties).length

      return {
        summary: `Hiện tại, VitaCare cung cấp dịch vụ khám và điều trị toàn diện tại **${totalCount} Chuyên khoa** chất lượng cao:\n\n🩺 **Các chuyên khoa tiêu biểu:** ${specList}.\n\nTất cả các khoa đều được trang bị thiết bị y tế hiện đại và đội ngũ bác sĩ chuyên khoa giàu kinh nghiệm.`,
        possibleCauses: [],
        careAdvice: [
          'Bạn có thể chọn chuyên khoa phù hợp ngay bên dưới để xem danh sách bác sĩ và đặt lịch khám',
          'Nếu cần tư vấn thêm về triệu chứng, bạn cứ nhắn trực tiếp cho tôi nhé!',
        ],
        isEmergency: false,
        recommendedSpecialtyCodes: specialties.slice(0, 3).map((s) => s.code),
        confidenceScore: 0.95,
        disclaimer,
      }
    }

    // 3. Câu hỏi về hotline / liên hệ
    if (/hotline|số điện thoại|sđt|liên hệ|tổng đài/i.test(lower)) {
      return {
        summary: `📞 **Thông tin liên hệ Phòng khám VitaCare:**\n\n- Hotline tư vấn đặt lịch: **0767 305 619**\n- Tổng đài CSKH: **1900 2115**\n- Email: **support@vitacare.vn**\n- Giờ phục vụ: 07:00 - 20:00 hàng ngày.`,
        possibleCauses: [],
        careAdvice: ['Bạn có thể gọi hotline để được nhân viên tiếp đón hỗ trợ hướng dẫn trực tiếp.'],
        isEmergency: false,
        recommendedSpecialtyCodes: [],
        confidenceScore: 0.98,
        disclaimer,
      }
    }

    // 4. Phân tích triệu chứng y khoa thông thường
    const matchedCodes: string[] = []
    if (/răng|buốt|nướu|hàm|lợi/i.test(lower)) matchedCodes.push('rhm')
    if (/tim|ngực|hồi hộp|nhịp tim|huyết áp/i.test(lower)) matchedCodes.push('tim-mach')
    if (/mắt|mờ|nhìn|cận|đỏ mắt/i.test(lower)) matchedCodes.push('mat')
    if (/tai|mũi|họng|viêm xoang|ho|sổ mũi|amidan/i.test(lower)) matchedCodes.push('tai-mui-hong')
    if (/da|ngứa|mẩn|mụn|dị ứng/i.test(lower)) matchedCodes.push('da-lieu')
    if (/xương|khớp|gối|lưng|cột sống|vai/i.test(lower)) matchedCodes.push('co-xuong-khop')
    if (/tiêu hóa|dạ dày|bụng|ợ chua|tiêu chảy|đại tràng/i.test(lower)) matchedCodes.push('tieu-hoa')
    if (/nhi|trẻ em|bé|sơ sinh/i.test(lower)) matchedCodes.push('nhi')
    if (/sản|phụ khoa|thai|kinh nguyệt/i.test(lower)) matchedCodes.push('san-phu-khoa')

    const validCodes = matchedCodes.filter((c) => specialties.some((s) => s.code === c))
    const finalCodes = validCodes.length > 0 ? validCodes : specialties.slice(0, 1).map((s) => s.code)

    return {
      summary: `Dựa trên mô tả triệu chứng "${text}", hệ thống ghi nhận bạn đang gặp các vấn đề sức khỏe cần được thăm khám định hướng.`,
      possibleCauses: [
        'Phản ứng viêm hoặc kích ứng cục bộ tại cơ quan liên quan',
        'Thay đổi thể trạng hoặc ảnh hưởng từ chế độ sinh hoạt/thời tiết',
        'Cần thực hiện thăm khám lâm sàng để bác sĩ chẩn đoán chính xác',
      ],
      careAdvice: [
        'Nghỉ ngơi hợp lý, bổ sung đủ nước và theo dõi sát diễn biến triệu chứng',
        'Không tự ý mua và sử dụng thuốc kháng sinh hay thuốc đặc trị khi chưa có chỉ định',
        'Nếu triệu chứng tăng nặng hoặc kéo dài quá 48 giờ, hãy đến cơ sở y tế khám ngay',
      ],
      isEmergency,
      emergencyReason: isEmergency ? 'Phát hiện triệu chứng có mức độ nghiêm trọng cao, vui lòng đến bệnh viện ngay!' : undefined,
      recommendedSpecialtyCodes: finalCodes,
      confidenceScore: 0.88,
      disclaimer,
    }
  }
}

