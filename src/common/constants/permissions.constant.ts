export enum AppPermission {
  // Nhóm Lịch hẹn
  APPOINTMENT_READ = 'appointment:read',
  APPOINTMENT_CREATE = 'appointment:create',
  APPOINTMENT_CHECKIN = 'appointment:checkin',
  APPOINTMENT_CANCEL = 'appointment:cancel',

  // Nhóm Khám bệnh & Cận lâm sàng
  CLINICAL_READ = 'clinical:read',
  CLINICAL_EXAMINE = 'clinical:examine',
  PRESCRIPTION_WRITE = 'prescription:write',
  CLINICAL_ORDER_CREATE = 'clinical_order:create',

  // Nhóm Vận hành chi nhánh & Ca trực
  SCHEDULE_MANAGE = 'schedule:manage',
  ROOM_MANAGE = 'room:manage',

  // Nhóm Tài chính & Viện phí
  FINANCE_COLLECT = 'finance:collect',
  FINANCE_READ = 'finance:read',

  // Nhóm Nhân sự & Quản trị hệ thống
  USER_READ = 'user:read',
  USER_MANAGE = 'user:manage',
}

export interface PermissionItem {
  code: AppPermission | string
  label: string
  description: string
  group: 'appointment' | 'clinical' | 'operation' | 'finance' | 'system'
}

export const PERMISSION_CATALOG: PermissionItem[] = [
  // Lịch hẹn
  {
    code: AppPermission.APPOINTMENT_READ,
    label: 'Xem danh sách & chi tiết lịch khám',
    description: 'Truy cập danh sách bệnh nhân hẹn khám, tra cứu thông tin ca khám và lịch sử hẹn.',
    group: 'appointment',
  },
  {
    code: AppPermission.APPOINTMENT_CREATE,
    label: 'Tạo lịch hẹn mới',
    description: 'Đặt lịch khám cho bệnh nhân trực tiếp tại quầy hoặc tiếp nhận qua điện thoại.',
    group: 'appointment',
  },
  {
    code: AppPermission.APPOINTMENT_CHECKIN,
    label: 'Xác nhận tiếp đón (Check-in) & Cấp số',
    description: 'Quét mã QR vé hẹn / CCCD, phân bổ buồng khám và đưa bệnh nhân vào hàng đợi bác sĩ.',
    group: 'appointment',
  },
  {
    code: AppPermission.APPOINTMENT_CANCEL,
    label: 'Hủy lịch hẹn của bệnh nhân',
    description: 'Thực hiện thao tác hủy ca hẹn và hoàn tiền / hủy giữ chỗ slot khám.',
    group: 'appointment',
  },

  // Khám bệnh
  {
    code: AppPermission.CLINICAL_READ,
    label: 'Xem hồ sơ bệnh án & lịch sử ca khám',
    description: 'Tra cứu tiền sử bệnh, kết quả cận lâm sàng và các đơn thuốc trước đó của bệnh nhân.',
    group: 'clinical',
  },
  {
    code: AppPermission.CLINICAL_EXAMINE,
    label: 'Thực hiện khám bệnh & chẩn đoán ICD-10',
    description: 'Mở ca khám trực tiếp, ghi nhận triệu chứng lâm sàng và kết luận mã bệnh lý ICD-10.',
    group: 'clinical',
  },
  {
    code: AppPermission.PRESCRIPTION_WRITE,
    label: 'Kê đơn thuốc điện tử',
    description: 'Lập đơn thuốc, hướng dẫn liều dùng và ký xuất đơn thuốc điện tử cho bệnh nhân.',
    group: 'clinical',
  },
  {
    code: AppPermission.CLINICAL_ORDER_CREATE,
    label: 'Chỉ định cận lâm sàng & xét nghiệm',
    description: 'Tạo phiếu chỉ định xét nghiệm máu, chụp X-quang, siêu âm và liên thông phòng máy.',
    group: 'clinical',
  },

  // Vận hành
  {
    code: AppPermission.SCHEDULE_MANAGE,
    label: 'Quản lý lịch làm việc & ca trực',
    description: 'Phân ca trực bác sĩ, mở hoặc đóng các khung giờ khám (slots) theo ngày.',
    group: 'operation',
  },
  {
    code: AppPermission.ROOM_MANAGE,
    label: 'Điều phối & cấu hình buồng khám',
    description: 'Gán chuyên khoa cho phòng khám, theo dõi tải buồng khám và trạng thái phòng.',
    group: 'operation',
  },

  // Tài chính
  {
    code: AppPermission.FINANCE_COLLECT,
    label: 'Thu viện phí & xuất hóa đơn tại quầy',
    description: 'Thu tiền mặt / quét mã MoMo, QR chuyển khoản và in hóa đơn thanh toán viện phí.',
    group: 'finance',
  },
  {
    code: AppPermission.FINANCE_READ,
    label: 'Xem báo cáo tài chính & doanh thu',
    description: 'Truy cập biểu đồ doanh thu theo ngày, tuần, tháng và dòng tiền viện phí.',
    group: 'finance',
  },

  // Hệ thống & Nhân sự
  {
    code: AppPermission.USER_READ,
    label: 'Xem danh sách tài khoản & nhân sự',
    description: 'Xem thông tin cơ sở, chuyên môn và thông tin liên hệ của nhân sự phòng khám.',
    group: 'system',
  },
  {
    code: AppPermission.USER_MANAGE,
    label: 'Quản lý nhân sự & phân quyền (RBAC)',
    description: 'Tạo tài khoản nhân viên, gán vai trò và tùy biến cấp/tước quyền cụ thể.',
    group: 'system',
  },
]

/**
 * Bộ quyền cơ bản mặc định theo từng Vai trò (Base Role Permissions)
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, AppPermission[]> = {
  admin: Object.values(AppPermission),
  branch_manager: [
    AppPermission.APPOINTMENT_READ,
    AppPermission.APPOINTMENT_CREATE,
    AppPermission.APPOINTMENT_CHECKIN,
    AppPermission.APPOINTMENT_CANCEL,
    AppPermission.CLINICAL_READ,
    AppPermission.SCHEDULE_MANAGE,
    AppPermission.ROOM_MANAGE,
    AppPermission.FINANCE_READ,
    AppPermission.USER_READ,
  ],
  doctor: [
    AppPermission.APPOINTMENT_READ,
    AppPermission.CLINICAL_READ,
    AppPermission.CLINICAL_EXAMINE,
    AppPermission.PRESCRIPTION_WRITE,
    AppPermission.CLINICAL_ORDER_CREATE,
  ],
  receptionist: [
    AppPermission.APPOINTMENT_READ,
    AppPermission.APPOINTMENT_CREATE,
    AppPermission.APPOINTMENT_CHECKIN,
    AppPermission.APPOINTMENT_CANCEL,
    AppPermission.FINANCE_COLLECT,
  ],
  patient: [
    AppPermission.APPOINTMENT_READ,
    AppPermission.APPOINTMENT_CREATE,
    AppPermission.CLINICAL_READ,
  ],
}

export interface CustomPermissionsPayload {
  granted?: string[]
  revoked?: string[]
}

/**
 * Tính toán quyền hiệu lực cuối cùng của User:
 * Effective = (Base Role Permissions + Granted) - Revoked
 */
export function calculateEffectivePermissions(
  role?: string | null,
  customPermissions?: CustomPermissionsPayload | string[] | any,
): string[] {
  const normalizedRole = String(role || 'patient').toLowerCase()
  const basePermissions = new Set<string>(
    (ROLE_DEFAULT_PERMISSIONS[normalizedRole] || []).map((p) => String(p)),
  )

  // Nếu là Admin thì có toàn bộ quyền
  if (normalizedRole === 'admin') {
    return Object.values(AppPermission).map((p) => String(p))
  }

  let grantedList: string[] = []
  let revokedList: string[] = []

  if (customPermissions && typeof customPermissions === 'object') {
    if (Array.isArray(customPermissions)) {
      // Trường hợp lưu mảng đơn giản: danh sách quyền override
      grantedList = customPermissions.map((x) => String(x))
    } else {
      if (Array.isArray(customPermissions.granted)) {
        grantedList = customPermissions.granted.map((x: any) => String(x))
      }
      if (Array.isArray(customPermissions.revoked)) {
        revokedList = customPermissions.revoked.map((x: any) => String(x))
      }
    }
  }

  // Thêm quyền được cấp (Grant)
  for (const perm of grantedList) {
    if (perm) basePermissions.add(perm)
  }

  // Loại trừ quyền bị tước (Revoke)
  for (const perm of revokedList) {
    if (perm) basePermissions.delete(perm)
  }

  return Array.from(basePermissions)
}
