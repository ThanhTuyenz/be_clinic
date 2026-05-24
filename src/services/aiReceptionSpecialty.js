function getOllamaBaseUrl() {
  return String(process.env.OLLAMA_BASE_URL || 'http://localhost:11434').trim().replace(/\/$/, '')
}

function getOllamaModel() {
  return String(process.env.OLLAMA_MODEL || 'qwen2.5:7b').trim()
}

export function buildReceptionSystemPrompt(specialtyNames = []) {
  const catalog = (specialtyNames || []).map((n) => String(n || '').trim()).filter(Boolean)
  const catalogBlock = catalog.length
    ? catalog.map((n) => `- ${n}`).join('\n')
  : '- (Danh sách chuyên khoa chưa được cấu hình; nếu không chắc, trả chuỗi rỗng.)'

  return `Bạn là lễ tân phòng khám. Nhiệm vụ duy nhất: đọc tin nhắn của bệnh nhân và gợi ý CHUYÊN KHOA để đặt lịch khám.

QUY TẮC BẮT BUỘC:
1. Chỉ lắng nghe, ghi nhận và định tuyến; không trò chuyện lan man, không hỏi thêm trong phản hồi kỹ thuật.
2. TUYỆT ĐỐI KHÔNG chẩn đoán bệnh, không nêu tên bệnh, không kê đơn, không dự đoán kết quả điều trị, không khẳng định chắc chắn.
3. Chỉ chọn tên chuyên khoa phù hợp để bệnh nhân đặt lịch; không giải thích y khoa.
4. Giá trị "chuyen_khoa" PHẢI trùng khớp (đúng chính tả) một mục trong danh sách chuyên khoa của phòng khám bên dưới.
5. Nếu bệnh nhân chưa mô tả đủ triệu chứng/nhu cầu, hoặc nội dung không liên quan y tế/đặt lịch: đặt "chuyen_khoa" là chuỗi rỗng "".
6. Nếu bệnh nhân nêu rõ tên khoa có trong danh sách: dùng đúng tên đó.
7. Nếu có dấu hiệu cấp cứu nghiêm trọng (đau ngực dữ dội, khó thở nặng, liệt nửa người, ngất, chảy máu nhiều...): ưu tiên "Cấp cứu" nếu có trong danh sách; nếu không có thì "".

DANH SÁCH CHUYÊN KHOA HỢP LỆ:
${catalogBlock}

ĐỊNH DẠNG TRẢ VỀ (BẮT BUỘC):
- Chỉ một object JSON hợp lệ, không markdown, không tiền tố/hậu tố, không văn bản ngoài JSON.
- Schema duy nhất: {"chuyen_khoa":"Tên chuyên khoa"}
- Ví dụ khi đủ thông tin: {"chuyen_khoa":"Tai Mũi Họng"}
- Ví dụ khi chưa đủ thông tin: {"chuyen_khoa":""}`
}

export function parseChuyenKhoaJson(rawContent) {
  const content = String(rawContent || '').trim()
  if (!content) {
    const err = new Error('AI không trả về nội dung.')
    err.code = 'AI_EMPTY_RESPONSE'
    throw err
  }

  const candidates = [content]
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(String(fenced[1]).trim())
  const objectMatch = content.match(/\{[\s\S]*\}/)
  if (objectMatch?.[0]) candidates.push(objectMatch[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const chuyenKhoa = String(parsed.chuyen_khoa ?? parsed.chuyenKhoa ?? '').trim()
      return { chuyen_khoa: chuyenKhoa }
    } catch {
      /* thử candidate tiếp theo */
    }
  }

  const err = new Error('AI trả về chuỗi không phải JSON hợp lệ theo schema {"chuyen_khoa":"..."}.')
  err.code = 'AI_INVALID_JSON'
  err.raw = content.slice(0, 500)
  throw err
}

export async function callOllamaForChuyenKhoa({ userText, specialtyNames }) {
  const base = getOllamaBaseUrl()
  const model = getOllamaModel()
  const system = buildReceptionSystemPrompt(specialtyNames)

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: String(userText || '').trim() },
      ],
      options: { temperature: 0.1 },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(text || `Ollama lỗi (${res.status}).`)
    err.code = 'AI_PROVIDER_ERROR'
    err.status = res.status
    throw err
  }

  const data = await res.json()
  const content = String(data?.message?.content || '').trim()
  return parseChuyenKhoaJson(content)
}

export async function extractChuyenKhoaFromMessage({ userText, specialtyNames, provider = 'ollama' }) {
  const message = String(userText || '').trim()
  if (!message) {
    const err = new Error('Thiếu tin nhắn của người dùng.')
    err.code = 'MISSING_MESSAGE'
    throw err
  }

  const p = String(provider || 'ollama').trim().toLowerCase()
  if (p !== 'ollama') {
    const err = new Error(`AI provider "${p}" chưa được hỗ trợ cho trích xuất chuyên khoa.`)
    err.code = 'AI_PROVIDER_UNSUPPORTED'
    throw err
  }

  return callOllamaForChuyenKhoa({ userText: message, specialtyNames })
}
