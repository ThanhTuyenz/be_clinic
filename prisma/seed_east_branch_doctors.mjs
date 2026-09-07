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

const time = (hour, minute = 0) => new Date(Date.UTC(1970, 0, 1, hour, minute, 0, 0));
const dateOnly = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

async function main() {
  const eastBranch = await prisma.branch.findUnique({ where: { code: 'VC-EAST' } });
  if (!eastBranch) {
    console.error('VC-EAST branch not found');
    return;
  }
  console.log('Found East Branch:', eastBranch.id, eastBranch.name);

  // 1. Ensure clinic room at East Branch
  const room = await prisma.clinicRoom.upsert({
    where: { branchId_code: { branchId: eastBranch.id, code: 'P201' } },
    update: { name: 'Phòng khám Đa khoa 201', isActive: true },
    create: { branchId: eastBranch.id, code: 'P201', name: 'Phòng khám Đa khoa 201' },
  });

  // 2. Find all active doctors
  const doctors = await prisma.doctor.findMany({
    where: { isActive: true },
    include: { user: true, specialties: true },
  });
  console.log(`Found ${doctors.length} doctors`);

  // 3. Assign each doctor to East Branch and create schedules
  for (const doc of doctors) {
    // Branch assignment
    await prisma.userBranchAssignment.upsert({
      where: { userId_branchId: { userId: doc.user.id, branchId: eastBranch.id } },
      update: {},
      create: { userId: doc.user.id, branchId: eastBranch.id, isPrimary: false },
    });

    // Create 10 weekdays of schedules for each doctor at East Branch
    let weekdaysCreated = 0;
    for (let day = 1; weekdaysCreated < 10; day += 1) {
      const workDate = dateOnly(day);
      if ([0, 6].includes(workDate.getUTCDay())) continue;

      const schedule = await prisma.doctorSchedule.upsert({
        where: {
          doctorId_branchId_workDate_startTime: {
            doctorId: doc.id,
            branchId: eastBranch.id,
            workDate,
            startTime: time(8),
          },
        },
        update: { status: 'OPEN', roomId: room.id, slotDurationMin: 60, capacityPerSlot: 10 },
        create: {
          doctorId: doc.id,
          branchId: eastBranch.id,
          roomId: room.id,
          workDate,
          startTime: time(8),
          endTime: time(11, 30),
          slotDurationMin: 60,
          capacityPerSlot: 10,
          status: 'OPEN',
        },
      });

      for (const [startHour, endHour, endMinute, capacity] of [
        [8, 9, 0, 10],
        [9, 10, 0, 10],
        [10, 11, 0, 10],
        [11, 11, 30, 10],
      ]) {
        await prisma.doctorScheduleSlot.upsert({
          where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: time(startHour) } },
          update: { endTime: time(endHour, endMinute), capacity, isActive: true },
          create: {
            scheduleId: schedule.id,
            startTime: time(startHour),
            endTime: time(endHour, endMinute),
            capacity,
          },
        });
      }
      weekdaysCreated += 1;
    }
  }

  console.log('Successfully assigned all doctors and schedules to VitaCare Cơ sở Đông (VC-EAST)!');
  await pool.end();
}

main().catch(console.error);
