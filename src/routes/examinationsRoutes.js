import { Router } from 'express'
import { upsertExamination } from '../controllers/examinationsController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.post('/', requireAuth, upsertExamination)

export default router
