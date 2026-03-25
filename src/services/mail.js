import nodemailer from 'nodemailer'

function hasSmtp() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS)
}

function createTransport() {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const host = (process.env.SMTP_HOST || '').toLowerCase()

  // Dùng preset Gmail — thường ổn định hơn chỉ gắn host/port tay.
  if (!process.env.SMTP_HOST || host === 'smtp.gmail.com' || host.includes('gmail')) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })
}

/**
 * Gửi mã OTP qua Gmail (SMTP).
 * - Nếu **không** có SMTP_USER + SMTP_PASS trong `.env` → **không gửi mail**,
 *   mã OTP chỉ in ra **cửa sổ terminal** nơi chạy `npm run dev` (be_clinic).
 * - Nếu có SMTP nhưng gửi lỗi → throw kèm thông báo để bạn sửa cấu hình.
 */
export async function sendOtpEmail(to, otp, recipientName) {
  const addr = process.env.SMTP_FROM || process.env.SMTP_USER

  const text = `Xin chào${recipientName ? ` ${recipientName}` : ''},

Mã xác thực đăng ký tài khoản Phòng khám ABC của bạn là: ${otp}

Mã có hiệu lực trong 10 phút. Không chia sẻ mã này cho người khác.

Trân trọng,
Phòng khám ABC`

  if (!hasSmtp()) {
    console.warn('')
    console.warn(
      '┌──────────────────────────────────────────────────────────────────────┐'
    )
    console.warn(
      '│  OTP — CHƯA gửi Gmail (thiếu SMTP_USER / SMTP_PASS trong be_clinic/.env)  │'
    )
    console.warn(
      '└──────────────────────────────────────────────────────────────────────┘'
    )
    console.warn(`  Email đích (đăng ký): ${to}`)
    console.warn(`  Mã OTP: ${otp}`)
    console.warn(
      '  → Thêm SMTP vào .env rồi khởi động lại server. Xem be_clinic/.env.example\n'
    )
    return { sent: false, devLog: true }
  }

  const transporter = createTransport()

  try {
    await transporter.sendMail({
      from: addr ? `"Phòng khám ABC" <${addr}>` : process.env.SMTP_USER,
      to,
      subject: 'Mã xác thực đăng ký — Phòng khám ABC',
      text,
    })
    console.log(`[be_clinic] Đã gửi email OTP tới ${to}`)
    return { sent: true }
  } catch (err) {
    const msg = err?.message || String(err)
    console.error('[be_clinic] Gửi email thất bại:', msg)
    if (err?.response) console.error('[be_clinic] SMTP response:', err.response)
    throw new Error(
      `Không gửi được email (${msg}). ` +
        'Với Gmail: bật 2FA, tạo "Mật khẩu ứng dụng" 16 ký tự và dán vào SMTP_PASS — không dùng mật khẩu đăng nhập Gmail thường.'
    )
  }
}
