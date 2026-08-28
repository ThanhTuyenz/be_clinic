import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js'
import {
  DoctorCardRecommendation,
  PackageCardRecommendation,
  SpecialtyRecommendation,
} from '../dtos/ai-chat.dto.js'

@Injectable()
export class DeterministicClinicalService {
  private readonly logger = new Logger(DeterministicClinicalService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy danh sách các chuyên khoa đang hoạt động để làm context cho LLM
   */
  async getActiveSpecialtiesContext(): Promise<Array<{ id: string; code: string; name: string }>> {
    const specialties = await this.prisma.specialty.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true },
      orderBy: { sortOrder: 'asc' },
    })
    return specialties.map((s) => ({
      id: String(s.id),
      code: s.slug || String(s.id),
      name: s.name,
    }))
  }

  /**
   * Lấy ngữ cảnh thông tin tổng quan phòng khám (Chi nhánh, địa chỉ, hotline, chuyên khoa)
   */
  async getClinicInformationContext(): Promise<{
    branches: Array<{ name: string; address?: string | null; phoneNumber?: string | null }>
    specialties: Array<{ name: string; description?: string | null }>
  }> {
    const [branches, specialties] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true },
        select: { name: true, address: true, phoneNumber: true },
      }),
      this.prisma.specialty.findMany({
        where: { isActive: true },
        select: { name: true, description: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ])

    return { branches, specialties }
  }


  /**
   * Tầng 5: Deterministic Internal Service - Query dữ liệu thực tế 100% từ PostgreSQL
   */
  async getClinicalRecommendations(specialtyCodes: string[]): Promise<{
    specialties: SpecialtyRecommendation[]
    doctors: DoctorCardRecommendation[]
    packages: PackageCardRecommendation[]
  }> {
    if (!specialtyCodes || specialtyCodes.length === 0) {
      return { specialties: [], doctors: [], packages: [] }
    }

    // 1. Tìm các chuyên khoa theo slug hoặc id hoặc name
    const specialties = await this.prisma.specialty.findMany({
      where: {
        isActive: true,
        OR: [
          { slug: { in: specialtyCodes } },
          { name: { in: specialtyCodes } },
        ],
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        iconUrl: true,
      },
    })

    const specialtyIds = specialties.map((s) => s.id)

    // 2. Tìm các bác sĩ tiêu biểu thuộc các chuyên khoa này
    const doctorsList = await this.prisma.doctor.findMany({
      where: {
        isActive: true,
        specialties: {
          some: {
            specialtyId: { in: specialtyIds },
          },
        },
      },
      take: 4,
      include: {
        user: {
          select: {
            fullName: true,
            branchAssignments: {
              take: 1,
              include: {
                branch: { select: { name: true } },
              },
            },
          },
        },
        specialties: {
          include: {
            specialty: { select: { name: true } },
          },
        },
      },
    })

    const doctors: DoctorCardRecommendation[] = doctorsList.map((doc) => ({
      id: doc.id,
      fullName: doc.user?.fullName || 'Bác sĩ chuyên khoa',
      title: doc.academicRank || 'Bác sĩ chuyên khoa',
      avatarUrl: doc.avatarUrl || undefined,
      specialtyName: doc.specialties[0]?.specialty?.name || 'Đa khoa',
      branchName: doc.user?.branchAssignments[0]?.branch?.name || 'Cơ sở chính VitaCare',
      consultationFee: Number(doc.consultationFee || 300000),
    }))


    // 3. Tìm các gói khám sức khỏe liên quan
    const servicePackages = await this.prisma.servicePackage.findMany({
      where: {
        isActive: true,
        OR: [
          { specialtyId: { in: specialtyIds } },
          { specialtyId: null }, // Gói khám tổng quát
        ],
      },
      take: 3,
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        branchBookingMethod: {
          select: {
            branch: { select: { name: true } },
          },
        },
      },
    })

    const packages: PackageCardRecommendation[] = servicePackages.map((pkg) => ({
      id: pkg.id,
      code: pkg.code,
      name: pkg.name,
      price: Number(pkg.price),
      branchName: pkg.branchBookingMethod?.branch?.name,
    }))

    return {
      specialties: specialties.map((s) => ({
        id: String(s.id),
        code: s.slug || String(s.id),
        name: s.name,
        description: s.description || undefined,
        iconUrl: s.iconUrl || undefined,
      })),
      doctors,
      packages,
    }
  }
}
