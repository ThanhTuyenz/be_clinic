import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import Role from '../models/Role.js'
import PendingRegistration from '../models/PendingRegistration.js'
import { sendOtpEmail } from '../services/mail.js'
import { generateOtp } from '../utils/otp.js'
import mongoose from 'mongoose'

const OTP_MS = 10 * 60 * 1000

function jwtSecret() {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'JWT_SECRET trong .env cần có ít nhất 16 ký tự (dùng cho ký token).'
    )
  }
  return s
}

function signAccessToken(user, roleName) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      userType: user.userType,
      role: roleName,
    },
    jwtSecret(),
    { expiresIn: '7d' }
  )
}

/** JWT ngắn hạn — bước xác nhận OTP sau đăng ký (không phải token đăng nhập). */
function signVerificationToken(userId) {
  return jwt.sign(
    { sub: userId.toString(), typ: 'email_verify' },
    jwtSecret(),
    { expiresIn: '15m' }
  )
}

function signPendingVerificationToken(pendingId) {
  return jwt.sign(
    { sub: pendingId.toString(), typ: 'pending_email_verify' },
    jwtSecret(),
    { expiresIn: '15m' }
  )
}

/** JWT ngắn hạn — dùng để hoàn tất đăng ký sau khi OTP đúng. */
function signCompleteRegisterToken(userId) {
  return jwt.sign(
    { sub: userId.toString(), typ: 'complete_register' },
    jwtSecret(),
    { expiresIn: '15m' }
  )
}

function signPendingCompleteToken(pendingId) {
  return jwt.sign(
    { sub: pendingId.toString(), typ: 'pending_complete_register' },
    jwtSecret(),
    { expiresIn: '15m' }
  )
}

function maskEmail(email) {
  const [u, d] = String(email).split('@')
  if (!d) return '***'
  const safe = u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***'
  return `${safe}@${d}`
}

/** Hiển thị kiểu Việt Nam: họ + tên */
function displayNameFromUser(user) {
  if (!user) return ''
  const s = [user.lastName, user.firstName].filter(Boolean).join(' ').trim()
  return s
}

function userPublicJson(user, roleName) {
  const displayName = displayNameFromUser(user)
  return {
    id: user._id,
    email: user.email,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    displayName: displayName || user.email,
    userType: user.userType,
    role: roleName,
  }
}

function isMongoObjectId(id) {
  return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)
}

export async function me(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: 'Token không hợp lệ.' })
    }

    const idStr = String(req.user.id).trim()
    let u = await User.collection.findOne(
      { _id: idStr },
      {
        projection: {
          email: 1,
          userType: 1,
          firstName: 1,
          lastName: 1,
          phone: 1,
          dob: 1,
          gender: 1,
          address: 1,
          citizenId: 1,
        },
      },
    )

    if (!u && isMongoObjectId(idStr)) {
      u = await User.collection.findOne(
        { _id: new mongoose.Types.ObjectId(idStr) },
        {
          projection: {
            email: 1,
            userType: 1,
            firstName: 1,
            lastName: 1,
            phone: 1,
            dob: 1,
            gender: 1,
            address: 1,
            citizenId: 1,
          },
        },
      )
    }

    if (!u) return res.status(404).json({ message: 'Không tìm thấy người dùng.' })

    if (String(u.userType || '').toLowerCase() !== 'patient') {
      return res.status(403).json({ message: 'Chỉ bệnh nhân mới xem được hồ sơ tại API này.' })
    }

    const displayName = displayNameFromUser(u) || u.email

    return res.status(200).json({
      user: {
        id: u._id,
        email: u.email,
        userType: u.userType,
        firstName: u.firstName ?? '',
        lastName: u.lastName ?? '',
        displayName,
        phone: u.phone ?? '',
        dob: u.dob ?? null,
        gender: u.gender ?? null,
        address: u.address ?? '',
        citizenId: u.citizenId ?? '',
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function register(req, res) {
  try {
    const { firstName, lastName, email, phone, password } = req.body
    if (
      !firstName?.trim() ||
      !lastName?.trim() ||
      !email?.trim() ||
      !phone?.trim() ||
      !password
    ) {
      return res.status(400).json({ message: 'Vui lòng nhập đủ họ, tên và thông tin còn lại.' })
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: 'Mật khẩu cần ít nhất 6 ký tự.' })
    }

    const emailNorm = String(email).trim().toLowerCase()
    const phoneNorm = String(phone).trim()

    const exists = await User.findOne({
      $or: [{ email: emailNorm }, { phone: phoneNorm }],
    })
    if (exists) {
      return res.status(409).json({
        message: 'Email hoặc số điện thoại đã được đăng ký.',
      })
    }

    const role = await Role.findOne({ name: 'patient' })
    if (!role) {
      return res.status(500).json({ message: 'Hệ thống chưa có vai trò bệnh nhân.' })
    }

    const otp = generateOtp()
    const emailOtpHash = await bcrypt.hash(otp, 8)
    const emailOtpExpires = new Date(Date.now() + OTP_MS)

    const passwordHash = await bcrypt.hash(password, 10)
    const fn = firstName.trim()
    const ln = lastName.trim()
    const user = await User.create({
      email: emailNorm,
      passwordHash,
      roleId: role._id,
      userType: 'patient',
      firstName: fn,
      lastName: ln,
      phone: phoneNorm,
      emailVerified: false,
      emailOtpHash,
      emailOtpExpires,
    })

    await sendOtpEmail(emailNorm, otp, displayNameFromUser({ firstName: fn, lastName: ln }))

    const verificationToken = signVerificationToken(user._id)

    return res.status(201).json({
      message:
        'Đã tạo tài khoản. Vui lòng nhập mã OTP đã gửi tới email để hoàn tất.',
      verificationToken,
      email: emailNorm,
      emailMask: maskEmail(emailNorm),
    })
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: 'Email hoặc số điện thoại đã tồn tại.' })
    }
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

/**
 * Bắt đầu đăng ký: chỉ cần email -> gửi OTP.
 * Chỉ tạo bản ghi pending (KHÔNG tạo User) cho tới khi hoàn tất bước cuối.
 */
export async function startRegister(req, res) {
  try {
    const { email } = req.body
    if (!email?.trim()) {
      return res.status(400).json({ message: 'Vui lòng nhập email.' })
    }

    const emailNorm = String(email).trim().toLowerCase()

    const exists = await User.findOne({ email: emailNorm })
    if (exists) {
      return res.status(409).json({ message: 'Email đã được đăng ký.' })
    }

    const otp = generateOtp()
    const emailOtpHash = await bcrypt.hash(otp, 8)
    const emailOtpExpires = new Date(Date.now() + OTP_MS)

    const pending = await PendingRegistration.findOneAndUpdate(
      { email: emailNorm },
      {
        $set: {
          email: emailNorm,
          emailOtpHash,
          emailOtpExpires,
          emailVerified: false,
        },
      },
      { upsert: true, new: true }
    ).select('_id email')

    await sendOtpEmail(emailNorm, otp, emailNorm)

    const verificationToken = signPendingVerificationToken(pending._id)

    return res.status(201).json({
      message: 'Đã gửi OTP. Vui lòng nhập mã để xác nhận email.',
      verificationToken,
      email: emailNorm,
      emailMask: maskEmail(emailNorm),
    })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Email đã tồn tại.' })
    }
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function verifyEmail(req, res) {
  try {
    const { verificationToken, otp } = req.body
    if (!verificationToken || otp === undefined || otp === null) {
      return res.status(400).json({
        message: 'Thiếu mã xác thực hoặc OTP.',
      })
    }

    let decoded
    try {
      decoded = jwt.verify(verificationToken, jwtSecret())
    } catch {
      return res.status(400).json({
        message:
          'Phiên xác thực hết hạn. Vui lòng nhấn Gửi lại mã hoặc đăng ký lại.',
      })
    }

    if (!decoded?.typ || !decoded?.sub) {
      return res.status(400).json({ message: 'Token xác thực không hợp lệ.' })
    }

    // Luồng pending: chưa tạo User trong DB
    if (decoded.typ === 'pending_email_verify') {
      const pending = await PendingRegistration.findById(decoded.sub).select(
        '+emailOtpHash +emailOtpExpires email emailVerified'
      )

      if (!pending) {
        return res.status(400).json({ message: 'Phiên đăng ký không tồn tại hoặc đã hết hạn.' })
      }
      if (pending.emailVerified) {
        return res.status(400).json({ message: 'Email đã được xác thực trước đó.' })
      }
      if (Date.now() > new Date(pending.emailOtpExpires).getTime()) {
        return res.status(400).json({ message: 'Mã OTP đã hết hạn. Vui lòng gửi lại mã.' })
      }
      const ok = await bcrypt.compare(String(otp).trim(), pending.emailOtpHash)
      if (!ok) {
        return res.status(400).json({ message: 'Mã OTP không đúng.' })
      }

      pending.emailVerified = true
      await pending.save()

      const completeToken = signPendingCompleteToken(pending._id)
      return res.json({
        message: 'Xác thực email thành công. Vui lòng tạo mật khẩu để hoàn tất đăng ký.',
        completeToken,
        email: pending.email,
        emailMask: maskEmail(pending.email),
      })
    }

    if (decoded.typ !== 'email_verify') {
      return res.status(400).json({ message: 'Token xác thực không hợp lệ.' })
    }

    const user = await User.findById(decoded.sub)
      .select('+emailOtpHash +emailOtpExpires')
      .populate('roleId', 'name description')

    if (!user) {
      return res.status(400).json({ message: 'Không tìm thấy tài khoản.' })
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email đã được xác thực trước đó.' })
    }

    if (!user.emailOtpHash || !user.emailOtpExpires) {
      return res.status(400).json({
        message: 'Không có mã OTP. Vui lòng gửi lại mã.',
      })
    }

    if (Date.now() > new Date(user.emailOtpExpires).getTime()) {
      return res.status(400).json({
        message: 'Mã OTP đã hết hạn. Vui lòng gửi lại mã.',
      })
    }

    const ok = await bcrypt.compare(String(otp).trim(), user.emailOtpHash)
    if (!ok) {
      return res.status(400).json({ message: 'Mã OTP không đúng.' })
    }

    user.emailVerified = true
    user.emailOtpHash = undefined
    user.emailOtpExpires = undefined
    await user.save()

    const roleName = user.roleId?.name ?? 'unknown'
    // Nếu user tạo theo luồng OTP trước và chưa đặt mật khẩu -> không đăng nhập,
    // trả token hoàn tất đăng ký để FE set mật khẩu.
    if (user.mustSetPassword) {
      const completeToken = signCompleteRegisterToken(user._id)
      return res.json({
        message: 'Xác thực email thành công. Vui lòng tạo mật khẩu để hoàn tất đăng ký.',
        completeToken,
        email: user.email,
        emailMask: maskEmail(user.email),
      })
    }

    const token = signAccessToken(user, roleName)

    return res.json({
      message: 'Xác thực email thành công. Bạn đã được đăng nhập.',
      token,
      user: userPublicJson(user, roleName),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function completeRegister(req, res) {
  try {
    const { completeToken, firstName, lastName, phone, password } = req.body
    if (!completeToken) {
      return res.status(400).json({ message: 'Thiếu phiên hoàn tất đăng ký.' })
    }
    if (
      !firstName?.trim() ||
      !lastName?.trim() ||
      !phone?.trim() ||
      !password
    ) {
      return res.status(400).json({ message: 'Vui lòng nhập đủ họ, tên và thông tin còn lại.' })
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Mật khẩu cần ít nhất 6 ký tự.' })
    }

    let decoded
    try {
      decoded = jwt.verify(completeToken, jwtSecret())
    } catch {
      return res.status(400).json({
        message: 'Phiên hoàn tất đăng ký đã hết hạn. Vui lòng xác thực OTP lại.',
      })
    }

    if (!decoded?.typ || !decoded?.sub) {
      return res.status(400).json({ message: 'Token hoàn tất đăng ký không hợp lệ.' })
    }

    // Luồng pending: lúc này mới tạo User
    if (decoded.typ === 'pending_complete_register') {
      const pending = await PendingRegistration.findById(decoded.sub).select('email emailVerified')
      if (!pending) {
        return res.status(400).json({ message: 'Phiên đăng ký không tồn tại hoặc đã hết hạn.' })
      }
      if (!pending.emailVerified) {
        return res.status(400).json({ message: 'Email chưa được xác thực.' })
      }

      const phoneNorm = String(phone).trim()
      const emailNorm = pending.email

      const exists = await User.findOne({
        $or: [{ email: emailNorm }, { phone: phoneNorm }],
      })
      if (exists) {
        return res.status(409).json({ message: 'Email hoặc số điện thoại đã được đăng ký.' })
      }

      const role = await Role.findOne({ name: 'patient' })
      if (!role) {
        return res.status(500).json({ message: 'Hệ thống chưa có vai trò bệnh nhân.' })
      }

      const passwordHash = await bcrypt.hash(password, 10)
      const user = await User.create({
        email: emailNorm,
        passwordHash,
        roleId: role._id,
        userType: 'patient',
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        phone: phoneNorm,
        emailVerified: true,
      })

      await PendingRegistration.deleteOne({ _id: pending._id })

      const roleName = role.name ?? 'patient'
      const token = signAccessToken(user, roleName)
      return res.json({
        message: 'Hoàn tất đăng ký thành công.',
        token,
        user: userPublicJson(user, roleName),
      })
    }

    if (decoded.typ !== 'complete_register') {
      return res.status(400).json({ message: 'Token hoàn tất đăng ký không hợp lệ.' })
    }

    const user = await User.findById(decoded.sub).populate('roleId', 'name description')
    if (!user) {
      return res.status(400).json({ message: 'Không tìm thấy tài khoản.' })
    }
    if (user.emailVerified !== true) {
      return res.status(400).json({ message: 'Email chưa được xác thực.' })
    }
    if (!user.mustSetPassword) {
      return res.status(400).json({ message: 'Tài khoản đã hoàn tất đăng ký.' })
    }

    const phoneNorm = String(phone).trim()
    if (phoneNorm) {
      const phoneExists = await User.findOne({
        phone: phoneNorm,
        _id: { $ne: user._id },
      })
      if (phoneExists) {
        return res.status(409).json({ message: 'Số điện thoại đã được sử dụng.' })
      }
    }

    user.firstName = String(firstName).trim()
    user.lastName = String(lastName).trim()
    user.phone = phoneNorm
    user.passwordHash = await bcrypt.hash(password, 10)
    user.mustSetPassword = false
    await user.save()

    const roleName = user.roleId?.name ?? 'unknown'
    const token = signAccessToken(user, roleName)

    return res.json({
      message: 'Hoàn tất đăng ký thành công.',
      token,
      user: userPublicJson(user, roleName),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function resendOtp(req, res) {
  try {
    const { email } = req.body
    if (!email?.trim()) {
      return res.status(400).json({ message: 'Vui lòng nhập email đã đăng ký.' })
    }

    const emailNorm = String(email).trim().toLowerCase()

    // Ưu tiên resend cho pending nếu đang trong luồng đăng ký mới
    const pending = await PendingRegistration.findOne({ email: emailNorm }).select(
      '+emailOtpHash +emailOtpExpires emailVerified'
    )
    if (pending && !pending.emailVerified) {
      const otp = generateOtp()
      pending.emailOtpHash = await bcrypt.hash(otp, 8)
      pending.emailOtpExpires = new Date(Date.now() + OTP_MS)
      await pending.save()

      await sendOtpEmail(emailNorm, otp, emailNorm)

      const verificationToken = signPendingVerificationToken(pending._id)
      return res.json({
        message: 'Đã gửi lại mã OTP.',
        verificationToken,
        emailMask: maskEmail(emailNorm),
      })
    }

    const user = await User.findOne({ email: emailNorm }).select(
      '+emailOtpHash +emailOtpExpires'
    )

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản với email này.' })
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email đã được xác thực.' })
    }

    const otp = generateOtp()
    user.emailOtpHash = await bcrypt.hash(otp, 8)
    user.emailOtpExpires = new Date(Date.now() + OTP_MS)
    await user.save()

    await sendOtpEmail(emailNorm, otp, displayNameFromUser(user))

    const verificationToken = signVerificationToken(user._id)

    return res.json({
      message: 'Đã gửi lại mã OTP.',
      verificationToken,
      emailMask: maskEmail(emailNorm),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function login(req, res) {
  try {
    const { email: loginId, password } = req.body
    if (!loginId?.trim() || !password) {
      return res.status(400).json({
        message: 'Vui lòng nhập email/số điện thoại và mật khẩu.',
      })
    }

    const raw = String(loginId).trim()
    const emailCandidate = raw.toLowerCase()

    const user = await User.findOne({
      $or: [{ email: emailCandidate }, { phone: raw }],
    }).populate('roleId', 'name description')

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Sai thông tin đăng nhập.' })
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      return res.status(401).json({ message: 'Sai thông tin đăng nhập.' })
    }

    if (user.mustSetPassword) {
      return res.status(403).json({
        code: 'PASSWORD_NOT_SET',
        message: 'Tài khoản chưa hoàn tất đăng ký. Vui lòng xác thực OTP và tạo mật khẩu.',
        email: user.email,
        emailMask: maskEmail(user.email),
      })
    }

    if (user.emailVerified === false) {
      const otp = generateOtp()
      user.emailOtpHash = await bcrypt.hash(otp, 8)
      user.emailOtpExpires = new Date(Date.now() + OTP_MS)
      await user.save()
      await sendOtpEmail(user.email, otp, displayNameFromUser(user))
      const verificationToken = signVerificationToken(user._id)
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        message:
          'Tài khoản chưa xác thực email. Đã gửi mã OTP đến hộp thư của bạn.',
        email: user.email,
        emailMask: maskEmail(user.email),
        verificationToken,
      })
    }

    const roleName = user.roleId?.name ?? 'unknown'
    const token = signAccessToken(user, roleName)

    return res.json({
      message: 'Đăng nhập thành công.',
      token,
      user: userPublicJson(user, roleName),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function staffLogin(req, res) {
  try {
    const { email: loginId, password } = req.body
    if (!loginId?.trim() || !password) {
      return res.status(400).json({
        message: 'Vui lòng nhập email/số điện thoại và mật khẩu.',
      })
    }

    const raw = String(loginId).trim()
    const emailCandidate = raw.toLowerCase()

    const user = await User.findOne({
      $or: [{ email: emailCandidate }, { phone: raw }],
    }).populate('roleId', 'name description')

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Sai thông tin đăng nhập.' })
    }

    if (user.userType === 'patient') {
      return res.status(403).json({
        code: 'STAFF_ONLY',
        message: 'Tài khoản này không thuộc nhóm nhân viên.',
      })
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      return res.status(401).json({ message: 'Sai thông tin đăng nhập.' })
    }

    // Nhân viên seed sẵn thường đã verified; vẫn giữ rule emailVerified nếu DB có.
    if (user.emailVerified === false) {
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Tài khoản chưa xác thực email.',
        email: user.email,
        emailMask: maskEmail(user.email),
      })
    }

    const roleName = user.roleId?.name ?? 'unknown'
    const token = signAccessToken(user, roleName)

    return res.json({
      message: 'Đăng nhập nhân viên thành công.',
      token,
      user: userPublicJson(user, roleName),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}
