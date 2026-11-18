import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { APPOINTMENT_STAFF_ROLES, appointmentScope, loadAppointmentActor } from '../appointments/helpers/appointment.helper.js';

type RecordProfile = {
  id: string;
  accountId: string | null;
  nationalId: string | null;
  patientCode: string | null;
};

/** Shared patient identity helps staff lookup; it never grants patient access. */
export async function patientRecordScope(
  prisma: PrismaService,
  userId: string,
  profile: RecordProfile,
): Promise<Prisma.AppointmentWhereInput> {
  const actor = await loadAppointmentActor(prisma, userId, [...APPOINTMENT_STAFF_ROLES, 'PATIENT']);
  if (actor.role === 'PATIENT') {
    if (profile.accountId !== actor.id) throw new ForbiddenException('Không có quyền truy cập hồ sơ bệnh án này');
    return { patientProfileId: profile.id, patientProfile: { accountId: actor.id } };
  }

  const identity: Prisma.AppointmentWhereInput = {
    OR: [
      { patientProfileId: profile.id },
      ...(profile.nationalId ? [{ patientProfile: { nationalId: profile.nationalId } }] : []),
      ...(profile.patientCode ? [{ patientProfile: { patientCode: profile.patientCode } }] : []),
    ],
  };
  const where: Prisma.AppointmentWhereInput = { AND: [identity, appointmentScope(actor)] };
  if (actor.role !== 'CHAIN_MANAGER') {
    const assigned = await prisma.appointment.findFirst({ where, select: { id: true } });
    if (!assigned) throw new ForbiddenException('Hồ sơ chưa có lịch khám thuộc phạm vi được phân công');
  }
  return where;
}
