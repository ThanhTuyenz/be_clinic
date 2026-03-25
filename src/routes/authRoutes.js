import { Router } from 'express'
import {
  login,
  register,
  resendOtp,
  verifyEmail,
} from '../controllers/authController.js'

const router = Router()

router.post('/register', register)
router.post('/verify-email', verifyEmail)
router.post('/resend-otp', resendOtp)
router.post('/login', login)

export default router
