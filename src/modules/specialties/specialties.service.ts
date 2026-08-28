import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class SpecialtiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /specialties
   * Danh sách tất cả chuyên khoa đang hoạt động
   */
  async getSpecialties(branchId?: string) {
    const specialties = await this.prisma.specialty.findMany({
      where: {
        ...(branchId
          ? { branches: { some: { branchId, isActive: true } } }
          : {}),
      } as any,
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        _count: {
          select: {
            doctors: { where: { doctor: { isActive: true } } },
            servicePackages: { where: { isActive: true } },
          },
        },
      } as any,
    })
    return (specialties as any[]).map(({ _count, ...s }) => ({
      ...s,
      doctorCount: _count?.doctors ?? 0,
      serviceCount: _count?.servicePackages ?? 0,
    }))
  }

  /**
   * GET /specialties/:id
   * Chi tiết 1 chuyên khoa
   */
  async getSpecialtyById(id: number) {
    const specialty = await this.prisma.specialty.findFirst({
      where: { id } as any,
      include: {
        branches: {
          where: { isActive: true },
          select: { branchId: true, branch: { select: { id: true, name: true, address: true } } },
        },
      },
    })
    if (!specialty) throw new NotFoundException('Không tìm thấy chuyên khoa')
    return specialty
  }

  /**
   * GET /specialties/:id/services
   * Gói khám / dịch vụ thuộc chuyên khoa (NULL specialtyId = gói tổng quát)
   */
  async getSpecialtyServices(specialtyId: number, branchId?: string) {
    const packages = await this.prisma.servicePackage.findMany({
      where: {
        specialtyId,
        isActive: true,
        branchBookingMethod: {
          isEnabled: true,
          bookingMethod: { isActive: true },
          ...(branchId ? { branchId } : {}),
        },
      },
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        price: true,
        durationMin: true,
        specialtyId: true,
        branchBookingMethod: {
          select: {
            id: true,
            branchId: true,
            bookingMethod: { select: { id: true, code: true, name: true, route: true } },
          },
        },
      },
    })
    return packages.map(({ branchBookingMethod, ...pkg }) => ({
      ...pkg,
      branchId: branchBookingMethod.branchId,
      branchBookingMethodId: branchBookingMethod.id,
      bookingMethod: branchBookingMethod.bookingMethod,
      price: Number(pkg.price),
    }))
  }


  /**
   * GET /specialties/:id/doctors
   * Bác sĩ thuộc chuyên khoa
   */
  async getSpecialtyDoctors(specialtyId: number, branchId?: string, q?: string) {
    const term = q?.trim()
    const doctors = await this.prisma.doctor.findMany({
      where: {
        isActive: true,
        specialties: { some: { specialtyId } },
        user: {
          ...(term ? { fullName: { contains: term, mode: 'insensitive' } } : {}),
          ...(branchId ? { branchAssignments: { some: { branchId } } } : {}),
        },
      },
      orderBy: [{ isFeatured: 'desc' }, { ratingAverage: 'desc' }, { user: { fullName: 'asc' } }],
      select: {
        id: true,
        academicRank: true,
        experienceYears: true,
        biography: true,
        avatarUrl: true,
        consultationFee: true,
        ratingAverage: true,
        ratingCount: true,
        isFeatured: true,
        specialties: {
          select: {
            isPrimary: true,
            specialty: { select: { id: true, name: true } },
          },
        },
        user: {
          select: {
            fullName: true,
            branchAssignments: {
              where: branchId ? { branchId } : undefined,
              select: {
                isPrimary: true,
                branch: { select: { id: true, name: true, address: true } },
              },
            },
          },
        },
      },
    })
    return doctors.map(({ user, ...doctor }) => ({
      ...doctor,
      fullName: user.fullName || 'Bác sĩ',
      consultationFee: Number(doctor.consultationFee),
      branchAssignments: user.branchAssignments,
    }))
  }

  /**
   * GET /services/:id
   * Chi tiết 1 gói dịch vụ / gói khám
   */
  async getServiceDetail(serviceId: string) {
    const pkg = await this.prisma.servicePackage.findFirst({
      where: { id: serviceId, isActive: true },
      include: {
        specialty: { select: { id: true, name: true, iconUrl: true } },
        branchBookingMethod: {
          include: {
            branch: { select: { id: true, name: true, address: true, phoneNumber: true } },
            bookingMethod: { select: { id: true, code: true, name: true, route: true } },
          },
        },
        schedules: {
          where: {
            isActive: true,
            examDate: { gte: new Date(new Date().toISOString().slice(0, 10)) },
            slots: { some: { isActive: true } },
          },
          orderBy: { examDate: 'asc' },
          take: 60,
          select: {
            id: true,
            examDate: true,
            room: { select: { id: true, code: true, name: true } },
            slots: {
              where: { isActive: true },
              orderBy: { startTime: 'asc' },
              select: {
                id: true,
                startTime: true,
                endTime: true,
                capacity: true,
                occupiedCount: true,
              },
            },
          },
        },
      },
    })
    if (!pkg) throw new NotFoundException('Không tìm thấy dịch vụ')
    const { branchBookingMethod, ...rest } = pkg
    return {
      ...rest,
      price: Number(rest.price),
      branchId: branchBookingMethod.branch.id,
      branch: branchBookingMethod.branch,
      branchBookingMethodId: branchBookingMethod.id,
      bookingMethod: branchBookingMethod.bookingMethod,
      schedules: rest.schedules.map((sch) => ({
        ...sch,
        examDate: sch.examDate.toISOString().slice(0, 10),
        slots: sch.slots.map((slot) => ({
          ...slot,
          startTime: slot.startTime.toISOString().slice(11, 16),
          endTime: slot.endTime.toISOString().slice(11, 16),
          remainingCapacity: slot.capacity - slot.occupiedCount,
          isAvailable: slot.occupiedCount < slot.capacity,
        })),
      })),
    }
  }

  /**
   * GET /services?q=&specialtyId=&branchId=
   * Tìm kiếm gói dịch vụ tổng quát (specialtyId NULL)
   */
  async getGeneralServices(branchId?: string, q?: string) {
    const term = q?.trim()
    const packages = await this.prisma.servicePackage.findMany({
      where: {
        specialtyId: null,
        isActive: true,
        branchBookingMethod: {
          isEnabled: true,
          bookingMethod: { isActive: true },
          ...(branchId ? { branchId } : {}),
        },
        ...(term ? { name: { contains: term, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        price: true,
        durationMin: true,
        branchBookingMethod: {
          select: {
            id: true,
            branchId: true,
            bookingMethod: { select: { id: true, code: true, name: true } },
          },
        },
      },
    })
    return packages.map(({ branchBookingMethod, ...pkg }) => ({
      ...pkg,
      price: Number(pkg.price),
      branchId: branchBookingMethod.branchId,
      branchBookingMethodId: branchBookingMethod.id,
      bookingMethod: branchBookingMethod.bookingMethod,
    }))
  }
}

