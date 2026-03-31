import { Router } from 'express'
import { createAppointment, listMyAppointments } from '../controllers/appointmentsController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.get('/my', requireAuth, listMyAppointments)
router.post('/', requireAuth, createAppointment)

export default router

