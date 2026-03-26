import { Router } from 'express'
import { createAppointment } from '../controllers/appointmentsController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.post('/', requireAuth, createAppointment)

export default router

