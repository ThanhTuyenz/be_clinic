import 'dotenv/config'
import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI

if (!uri || uri.includes('USERNAME') || uri.includes('PASSWORD')) {
  console.error(
    'Thiếu MONGODB_URI hoặc chưa thay USERNAME/PASSWORD.\n' +
      'Tạo file .env từ .env.example và dán connection string từ MongoDB Atlas.'
  )
  process.exit(1)
}

const client = new MongoClient(uri)

try {
  await client.connect()
  await client.db('admin').command({ ping: 1 })
  console.log('Kết nối MongoDB Atlas thành công (ping OK).')

  const admin = client.db().admin()
  const { databases } = await admin.listDatabases()
  const names = databases.map((d) => d.name).join(', ')
  console.log('Các database hiện có:', names || '(trống)')
} catch (err) {
  console.error('Lỗi kết nối:', err.message)
  process.exitCode = 1
} finally {
  await client.close()
}
