import nodemailer from 'nodemailer'
import QRCode from 'qrcode'

const CLINIC_NAME = 'Phòng khám VitaCare Clinic'

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

Mã xác thực đăng ký tài khoản ${CLINIC_NAME} của bạn là: ${otp}

Mã có hiệu lực trong 10 phút. Không chia sẻ mã này cho người khác.

Trân trọng,
${CLINIC_NAME}`

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
      from: addr ? `"${CLINIC_NAME}" <${addr}>` : process.env.SMTP_USER,
      to,
      subject: `Mã xác thực đăng ký — ${CLINIC_NAME}`,
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

function formatAppointmentDateVi(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  return `${dd}/${mm}/${yy}`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Gửi email xác nhận đặt lịch kèm mã QR vé.
 * Không có SMTP → in thông tin ra terminal (dev), không chặn luồng đặt lịch.
 */
export async function sendAppointmentConfirmationEmail({
  to,
  recipientName,
  ticket,
  appointmentDate,
  startTime,
  doctorName,
  specialtyName,
}) {
  const addr = process.env.SMTP_FROM || process.env.SMTP_USER
  const ticketCode = String(ticket || '').trim().toUpperCase()
  const dateLabel = formatAppointmentDateVi(appointmentDate)
  const timeLabel = String(startTime || '').trim()
  const doctorLabel = String(doctorName || '').trim() || 'Bác sĩ'
  const specialtyLabel = String(specialtyName || '').trim()
  const greeting = recipientName ? ` ${String(recipientName).trim()}` : ''

  const detailLines = [
    dateLabel ? `Ngày khám: ${dateLabel}` : '',
    timeLabel ? `Giờ khám: ${timeLabel}` : '',
    `Bác sĩ: ${doctorLabel}`,
    specialtyLabel ? `Chuyên khoa: ${specialtyLabel}` : '',
    `Mã vé: ${ticketCode}`,
  ].filter(Boolean)

  const text = `Xin chào${greeting},

Bạn đã đặt lịch khám thành công tại ${CLINIC_NAME}.

${detailLines.join('\n')}

Khi đến khám, vui lòng xuất trình mã QR trong email này hoặc mã vé ở mục "Lịch khám" trên ứng dụng.

Trân trọng,
${CLINIC_NAME}`

  if (!hasSmtp()) {
    console.warn('')
    console.warn(
      '┌────────────────────────────────────────────────────────────────────────────┐'
    )
    console.warn(
      '│  Đặt lịch — CHƯA gửi Gmail (thiếu SMTP_USER / SMTP_PASS trong be_clinic/.env) │'
    )
    console.warn(
      '└────────────────────────────────────────────────────────────────────────────┘'
    )
    console.warn(`  Email đích: ${to}`)
    console.warn(`  Mã vé: ${ticketCode}`)
    if (dateLabel) console.warn(`  Ngày khám: ${dateLabel}`)
    if (timeLabel) console.warn(`  Giờ khám: ${timeLabel}`)
    console.warn(`  Bác sĩ: ${doctorLabel}`)
    console.warn(
      '  → Thêm SMTP vào .env rồi khởi động lại server. Xem be_clinic/.env.example\n'
    )
    return { sent: false, devLog: true }
  }

  const qrPng = await QRCode.toBuffer(ticketCode, { type: 'png', width: 220, margin: 1 })
  const transporter = createTransport()
  const htmlDetails = detailLines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('')

  const html = `<!DOCTYPE html>
<html lang="vi">
<body style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#1f2937;">
  <p>Xin chào${escapeHtml(greeting)},</p>
  <p>Bạn đã <strong>đặt lịch khám thành công</strong> tại ${escapeHtml(CLINIC_NAME)}.</p>
  <ul>${htmlDetails}</ul>
  <p style="margin:20px 0 8px;">Mã QR vé lịch hẹn:</p>
  <p><img src="cid:appointment-qr" alt="Mã QR lịch khám ${escapeHtml(ticketCode)}" width="220" height="220" /></p>
  <p style="color:#4b5563;font-size:14px;">Khi đến khám, xuất trình mã QR này hoặc mã vé trong mục &quot;Lịch khám&quot; trên ứng dụng.</p>
  <p>Trân trọng,<br/>${escapeHtml(CLINIC_NAME)}</p>
</body>
</html>`

  try {
    await transporter.sendMail({
      from: addr ? `"${CLINIC_NAME}" <${addr}>` : process.env.SMTP_USER,
      to,
      subject: `Xác nhận đặt lịch khám — ${CLINIC_NAME}`,
      text,
      html,
      attachments: [
        {
          filename: 'ma-qr-lich-kham.png',
          content: qrPng,
          cid: 'appointment-qr',
        },
      ],
    })
    console.log(`[be_clinic] Đã gửi email xác nhận lịch khám tới ${to} (vé ${ticketCode})`)
    return { sent: true }
  } catch (err) {
    const msg = err?.message || String(err)
    console.error('[be_clinic] Gửi email xác nhận lịch khám thất bại:', msg)
    if (err?.response) console.error('[be_clinic] SMTP response:', err.response)
    throw new Error(
      `Không gửi được email xác nhận lịch khám (${msg}). ` +
        'Với Gmail: bật 2FA, tạo "Mật khẩu ứng dụng" 16 ký tự và dán vào SMTP_PASS — không dùng mật khẩu đăng nhập Gmail thường.'
    )
  }
}
