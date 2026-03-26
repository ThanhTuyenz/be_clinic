import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { connectDb } from './config/db.js'
import authRoutes from './routes/authRoutes.js'
import doctorsRoutes from './routes/doctorsRoutes.js'
import appointmentsRoutes from './routes/appointmentsRoutes.js'

const app = express()
const PORT = Number(process.env.PORT) || 5000
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'

app.use(cors({ origin: corsOrigin, credentials: true }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'be_clinic' })
})

app.use('/api/auth', authRoutes)
app.use('/api/doctors', doctorsRoutes)
app.use('/api/appointments', appointmentsRoutes)

app.use((_req, res) => {
  res.status(404).json({ message: 'Không tìm thấy.' })
})

async function main() {
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
      console.error(
        'Thiếu JWT_SECRET trong .env (cần ít nhất 16 ký tự, dùng để ký token đăng nhập).'
      )
      process.exit(1)
    }
    await connectDb()
    app.listen(PORT, () => {
      console.log(`API chạy tại http://localhost:${PORT}`)
      console.log(`CORS cho phép: ${corsOrigin}`)
    })
  } catch (err) {
    console.error('Không khởi động được:', err.message)
    process.exit(1)
  }
}

main()
