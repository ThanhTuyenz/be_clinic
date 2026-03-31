import { Router } from 'express'
import { createAppointment, getAvailability, listMyAppointments } from '../controllers/appointmentsController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.get('/my', requireAuth, listMyAppointments)
router.get('/availability', requireAuth, getAvailability)
router.post('/', requireAuth, createAppointment)

export default router

