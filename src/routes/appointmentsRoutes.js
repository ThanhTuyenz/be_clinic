import { Router } from 'express'
import {
  cancelAppointment,
  createAppointment,
  getAvailability,
  listMyAppointments,
} from '../controllers/appointmentsController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.get('/my', requireAuth, listMyAppointments)
router.get('/availability', requireAuth, getAvailability)
router.patch('/:id/cancel', requireAuth, cancelAppointment)
router.post('/', requireAuth, createAppointment)

export default router

