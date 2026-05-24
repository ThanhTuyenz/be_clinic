import { Router } from 'express'
import {
  cancelAppointment,
  createAppointment,
  createAppointmentReception,
  getAvailability,
  getDoctorScheduleDates,
  listDoctorAppointments,
  listMyAppointments,
  finishExamAppointment,
  listPatientHistoryReception,
  listPatientsReception,
  listReceptionAppointments,
  lookupAppointmentByTicket,
  lookupPatientByCode,
  recordAppointmentPayment,
  updateAppointmentStatusReception,
} from '../controllers/appointmentsController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.get('/my', requireAuth, listMyAppointments)
router.get('/doctor', requireAuth, listDoctorAppointments)
router.get('/lookup-ticket', requireAuth, lookupAppointmentByTicket)
router.get('/patient-by-code', requireAuth, lookupPatientByCode)
router.get('/patients', requireAuth, listPatientsReception)
router.get('/patient-history', requireAuth, listPatientHistoryReception)
router.get('/reception', requireAuth, listReceptionAppointments)
router.get('/availability', requireAuth, getAvailability)
router.get('/schedule-dates', requireAuth, getDoctorScheduleDates)
router.post('/reception', requireAuth, createAppointmentReception)
router.patch('/:id/finish-exam', requireAuth, finishExamAppointment)
router.post('/:id/payment', requireAuth, recordAppointmentPayment)
router.patch('/:id/status', requireAuth, updateAppointmentStatusReception)
router.patch('/:id/cancel', requireAuth, cancelAppointment)
router.post('/', requireAuth, createAppointment)

export default router

