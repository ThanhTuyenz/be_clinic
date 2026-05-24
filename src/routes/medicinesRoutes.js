import { Router } from 'express'
import { listMedicines } from '../controllers/medicinesController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

router.get('/', requireAuth, listMedicines)

export default router
