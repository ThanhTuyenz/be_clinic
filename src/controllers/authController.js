import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import Role from '../models/Role.js'

function jwtSecret() {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'JWT_SECRET trong .env cần có ít nhất 16 ký tự (dùng cho ký token).'
    )
  }
  return s
}

function signToken(user, roleName) {
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

export async function register(req, res) {
  try {
    const { fullName, email, phone, password } = req.body
    if (!fullName?.trim() || !email?.trim() || !phone?.trim() || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập đủ thông tin.' })
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

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await User.create({
      email: emailNorm,
      passwordHash,
      roleId: role._id,
      userType: 'patient',
      fullName: fullName.trim(),
      phone: phoneNorm,
    })

    return res.status(201).json({
      message: 'Đăng ký thành công.',
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        userType: user.userType,
      },
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

    const roleName = user.roleId?.name ?? 'unknown'
    const token = signToken(user, roleName)

    return res.json({
      message: 'Đăng nhập thành công.',
      token,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        userType: user.userType,
        role: roleName,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}
