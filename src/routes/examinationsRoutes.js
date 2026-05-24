import { Router } from 'express'
import { getExaminationByAppointment, upsertExamination } from '../controllers/examinationsController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.get('/', requireAuth, getExaminationByAppointment)
router.post('/', requireAuth, upsertExamination)

export default router
