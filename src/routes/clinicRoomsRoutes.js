import { Router } from 'express'
import { listClinicRooms } from '../controllers/clinicRoomsController.js'

const router = Router()

router.get('/', listClinicRooms)

export default router
