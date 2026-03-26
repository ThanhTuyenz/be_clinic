import mongoose from 'mongoose'
import { seedRoles } from './seedRoles.js'
import { seedDoctors } from './seedDoctors.js'

export async function connectDb() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error('Thiếu biến MONGODB_URI trong .env')
  }
  await mongoose.connect(uri)
  await seedRoles()
  await seedDoctors()
}
