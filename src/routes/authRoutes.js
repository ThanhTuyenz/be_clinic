import { Router } from 'express'
import {
  login,
  staffLogin,
  me,
  updateMe,
  register,
  startRegister,
  completeRegister,
  resendOtp,
  verifyEmail,
} from '../controllers/authController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.post('/register', register)
router.post('/start-register', startRegister)
router.post('/verify-email', verifyEmail)
router.post('/complete-register', completeRegister)
router.post('/resend-otp', resendOtp)
router.post('/login', login)
router.post('/staff-login', staffLogin)
router.get('/me', requireAuth, me)
router.patch('/me', requireAuth, updateMe)

export default router
