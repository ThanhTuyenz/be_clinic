import { ForbiddenException } from '@nestjs/common'
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

// --- Date Utilities ---

export function parseDateRange(dateStr?: string) {
  let year: number, month: number, date: number
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number)
    year = y; month = m - 1; date = d
  } else {
    const now = new Date()
    year = now.getFullYear(); month = now.getMonth(); date = now.getDate()
  }
  const from = new Date(Date.UTC(year, month, date, 0, 0, 0, 0))
  const to = new Date(Date.UTC(year, month, date + 1, 0, 0, 0, 0))
  const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`
  return { from, to, dateKey }
}

export function parseDate(dateStr?: string): Date | undefined {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return undefined
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
}

export function formatTime(value: Date): string {
  return value.toISOString().slice(11, 16)
}

// --- UUID Utilities ---

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

// --- Staff Auth Utilities ---

export async function getStaffUser(prisma: PrismaService, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, branchId: true },
  })
  if (!user || user.role === 'PATIENT') {
    throw new ForbiddenException('Chi nhan vien phong kham moi co quyen truy cap')
  }
  return user
}

export function resolveBranchId(
  user: { role: string; branchId: number | null },
  requestedBranchId?: number,
): number | undefined {
  if (user.role === 'CHAIN_MANAGER') {
    return requestedBranchId !== undefined ? requestedBranchId : undefined
  }
  if (requestedBranchId !== undefined && user.branchId === requestedBranchId) {
    return requestedBranchId
  }
  return user.branchId || undefined
}
