import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { connectDb } from './config/db.js'
import authRoutes from './routes/authRoutes.js'
import doctorsRoutes from './routes/doctorsRoutes.js'
import appointmentsRoutes from './routes/appointmentsRoutes.js'

const app = express()
const PORT = Number(process.env.PORT) || 5000
const corsOriginRaw = process.env.CORS_ORIGIN || 'http://localhost:5173'
const corsAllowlist = String(corsOriginRaw)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// API responses should not be cached by the browser during development.
// Also disable ETag to avoid 304 responses with empty bodies.
app.set('etag', false)

app.use(
  cors({
    origin(origin, cb) {
      // allow non-browser tools (no origin) like curl/postman
      if (!origin) return cb(null, true)
      if (corsAllowlist.includes('*')) return cb(null, true)
      if (corsAllowlist.includes(origin)) return cb(null, true)
      return cb(new Error(`CORS blocked for origin: ${origin}`))
    },
    credentials: true,
  }),
)
app.use(express.json())

// Minimal request logger for debugging API traffic
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - start
    console.log(`[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`)
  })
  next()
})

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

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
      console.log(`CORS cho phép: ${corsAllowlist.join(', ')}`)
    })
  } catch (err) {
    console.error('Không khởi động được:', err.message)
    process.exit(1)
  }
}

main()
