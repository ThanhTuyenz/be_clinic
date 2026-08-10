import dotenv from 'dotenv'
import { MongoClient, ObjectId } from 'mongodb'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: '.env.development' })
dotenv.config()

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI
const mongoDbName = process.env.MONGO_DB_NAME || 'clinic'
const medicineCollection = process.env.MONGO_MED_COLLECTION || 'medicine'
if (!mongoUri) throw new Error('Thiếu MONGODB_URI hoặc MONGO_URI')

const mongo = new MongoClient(mongoUri)
const prisma = new PrismaClient()

function text(value) {
  const result = String(value ?? '').trim()
  return result || null
}

function uuid(value) {
  const result = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result) ? result : null
}

async function migrateMedicines(db) {
  const rows = await db.collection(medicineCollection).find({ active: { $ne: false } }).toArray()
  let migrated = 0
  for (const row of rows) {
    const name = text(row.name)
    if (!name) continue
    const code = text(row.code) || `MED-${String(row._id instanceof ObjectId ? row._id : new ObjectId()).toUpperCase()}`
    await prisma.medicine.upsert({
      where: { code },
      update: {
        name,
        activeIngredient: text(row.activeIngredient || row.ingredient),
        strength: text(row.strength || row.concentration),
        unit: text(row.unit),
        isActive: row.active !== false,
      },
      create: {
        code,
        name,
        activeIngredient: text(row.activeIngredient || row.ingredient),
        strength: text(row.strength || row.concentration),
        unit: text(row.unit),
        isActive: row.active !== false,
      },
    })
    migrated++
  }
  return { source: rows.length, migrated }
}

async function migrateMedicalVisits(db) {
  const rows = await db.collection('examination').find({}).toArray()
  let migrated = 0
  let skippedIncompatibleAppointmentId = 0
  for (const row of rows) {
    const appointmentId = uuid(row.appointmentId)
    if (!appointmentId) {
      skippedIncompatibleAppointmentId++
      continue
    }
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { patientProfileId: true, doctor: { select: { userId: true } } },
    })
    if (!appointment) {
      skippedIncompatibleAppointmentId++
      continue
    }
    const { _id, appointmentId: _legacyAppointmentId, createdAt, updatedAt, ...payload } = row
    const medicalRecord = await prisma.medicalRecord.upsert({
      where: { patientProfileId: appointment.patientProfileId },
      update: {},
      create: {
        patientProfileId: appointment.patientProfileId,
        recordCode: `MR-${appointment.patientProfileId.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      },
    })
    await prisma.medicalVisit.upsert({
      where: { appointmentId },
      update: { payload },
      create: { medicalRecordId: medicalRecord.id, appointmentId, createdById: appointment.doctor.userId, payload },
    })
    migrated++
  }
  return { source: rows.length, migrated, skippedIncompatibleAppointmentId }
}

try {
  await mongo.connect()
  const db = mongo.db(mongoDbName)
  const medicines = await migrateMedicines(db)
  const medicalVisits = await migrateMedicalVisits(db)
  console.log(JSON.stringify({ medicines, medicalVisits }, null, 2))
} finally {
  await Promise.allSettled([mongo.close(), prisma.$disconnect()])
}
