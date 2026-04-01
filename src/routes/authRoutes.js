import { Router } from 'express'
import {
  login,
  staffLogin,
  me,
  register,
  resendOtp,
  verifyEmail,
} from '../controllers/authController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.post('/register', register)
router.post('/verify-email', verifyEmail)
router.post('/resend-otp', resendOtp)
router.post('/login', login)
router.post('/staff-login', staffLogin)
router.get('/me', requireAuth, me)

export default router
