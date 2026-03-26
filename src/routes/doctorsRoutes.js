import { Router } from 'express'
import { listDoctors } from '../controllers/doctorsController.js'

const router = Router()

router.get('/', listDoctors)

export default router

