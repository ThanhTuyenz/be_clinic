import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class PiiSanitizerService {
  private readonly logger = new Logger(PiiSanitizerService.name)

  // Regex nhận diện SĐT Việt Nam: 10-11 số
  private readonly phoneRegex = /(?:\+84|0)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b/g

  // Regex nhận diện số CCCD / CMND: 9 hoặc 12 số
  private readonly nationalIdRegex = /\b\d{12}\b|\b\d{9}\b/g

  // Regex nhận diện Email
  private readonly emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

  // Danh sách các từ khóa cố tình prompt injection / jailbreak
  private readonly injectionPatterns = [
    /ignore\s+(previous|all)\s+instructions/i,
    /bỏ\s+qua\s+(toàn\s+bộ|hết|các)\s+chỉ\s+dẫn/i,
    /system\s+prompt/i,
    /you\s+are\s+now\s+a\s+doctor\s+prescribing/i,
    /bây\s+giờ\s+bạn\s+là\s+bác\s+sĩ\s+kê\s+đơn/i,
    /act\s+as\s+a\s+pharmacist/i,
    /hack|jailbreak/i,
  ]

  /**
   * Tầng 1: Lọc bỏ toàn bộ thông tin định danh cá nhân (PII)
   */
  sanitizeInput(rawText: string): { sanitizedText: string; hasRedactions: boolean } {
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

    // Tầng 2: Vô hiệu hóa Prompt Injection
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(sanitized)) {
        this.logger.warn(`Phát hiện chuỗi nghi vấn Prompt Injection: ${sanitized}`)
        sanitized = sanitized.replace(pattern, '[LỆNH KHÔNG HỢP LỆ]')
      }
    }

    return { sanitizedText: sanitized.trim(), hasRedactions }
  }
}
