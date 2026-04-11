import { Router } from 'express'
import {
  cancelAppointment,
  createAppointment,
  createAppointmentReception,
  getAvailability,
  listDoctorAppointments,
  listMyAppointments,
  listReceptionAppointments,
  lookupAppointmentByTicket,
  updateAppointmentStatusReception,
} from '../controllers/appointmentsController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.get('/my', requireAuth, listMyAppointments)
router.get('/doctor', requireAuth, listDoctorAppointments)
router.get('/lookup-ticket', requireAuth, lookupAppointmentByTicket)
router.get('/reception', requireAuth, listReceptionAppointments)
router.get('/availability', requireAuth, getAvailability)
router.post('/reception', requireAuth, createAppointmentReception)
router.patch('/:id/status', requireAuth, updateAppointmentStatusReception)
router.patch('/:id/cancel', requireAuth, cancelAppointment)
router.post('/', requireAuth, createAppointment)

export default router

