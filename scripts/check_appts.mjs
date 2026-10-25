import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';

const envFile = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  const doctorUser = await prisma.user.findUnique({
    where: { email: 'doctor.pediatrics@vitacare.local' },
    include: { doctor: true }
  });
  console.log('Doctor User:', doctorUser?.id, 'Doctor ID:', doctorUser?.doctor?.id);

  const appointments = await prisma.appointment.findMany({
    where: {
      scheduleSlot: {
        schedule: {
          doctorId: doctorUser?.doctor?.id
        }
      }
    },
    select: {
      id: true,
      bookingCode: true,
      status: true,
      scheduleSlot: {
        select: {
          startTime: true,
          schedule: {
            select: {
              workDate: true,
              doctorId: true
            }
          }
        }
      }
    }
  });
  console.log('Appointments count for doctor:', appointments.length);
  console.log('Appointments sample for this doctor:', JSON.stringify(appointments.slice(0, 5), null, 2));

  // Check all appointments in system with doctor
  const allAppts = await prisma.appointment.findMany({
    take: 10,
    select: {
      bookingCode: true,
      status: true,
      scheduleSlot: {
        select: {
          schedule: {
            select: {
              workDate: true,
              doctor: {
                select: {
                  user: { select: { fullName: true, email: true } }
                }
              }
            }
          }
        }
      }
    }
  });
  console.log('Sample appts in system:', JSON.stringify(allAppts, null, 2));
}

run().catch(console.error).finally(() => pool.end());
