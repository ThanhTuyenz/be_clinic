export enum AppPermission {
  // 1. Nhóm Lịch hẹn (Appointments)
  APPOINTMENT_READ = 'appointment:read',
  APPOINTMENT_CREATE = 'appointment:create',
  APPOINTMENT_CHECKIN = 'appointment:checkin',
  APPOINTMENT_CANCEL = 'appointment:cancel',

  // 2. Nhóm Bệnh nhân & Hồ sơ y tế (Patients)
  PATIENT_READ = 'patient:read',
  PATIENT_MANAGE = 'patient:manage',
  CLINICAL_READ = 'clinical:read',
  CLINICAL_WRITE = 'clinical:write',

  // 3. Nhóm Vận hành chi nhánh & Cơ sở vật chất (Branch & Operations)
  BRANCH_READ = 'branch:read',
  BRANCH_MANAGE = 'branch:manage',       // Tạo/sửa chi nhánh (Super Admin)
  ROOM_MANAGE = 'room:manage',           // Quản lý phòng khám tại chi nhánh
  SCHEDULE_READ = 'schedule:read',       // Xem lịch làm việc & ca trực
  SCHEDULE_MANAGE = 'schedule:manage',   // Xếp lịch làm việc bác sĩ

  // 4. Nhóm Chuyên môn & Dịch vụ y tế (Medical Services)
  SPECIALTY_MANAGE = 'specialty:manage', // Quản lý chuyên khoa
  SERVICE_MANAGE = 'service:manage',     // Quản lý danh mục dịch vụ & bảng giá

  // 5. Nhóm Tài chính & Hóa đơn (Finance & Billing)
  FINANCE_COLLECT = 'finance:collect',   // Thu tiền / Xuất hóa đơn tại quầy (Lễ tân)
  FINANCE_READ = 'finance:read',         // Xem chi tiết giao dịch / hóa đơn

  // 6. Nhóm Báo cáo & Thống kê (Reports & Analytics)
  REPORT_BRANCH_READ = 'report:branch_read', // Xem báo cáo chi nhánh mình
  REPORT_SYSTEM_READ = 'report:system_read', // Xem báo cáo tổng toàn hệ thống (Super Admin)

  // 7. Nhóm Nhân sự & Phân quyền (Users & RBAC)
  USER_READ = 'user:read',
  USER_MANAGE = 'user:manage',           // Tạo/sửa tài khoản nhân viên
  ROLE_MANAGE = 'role:manage',           // Tạo vai trò & gán permission (Super Admin)

  // 8. Nhóm Cấu hình Hệ thống (System Config)
  SYSTEM_CONFIG_MANAGE = 'system:config_manage', // Cấu hình hình thức đặt khám, app settings
}

export type PermissionGroup =
  | 'appointment'
  | 'patient'
  | 'clinical'
  | 'operation'
  | 'service'
  | 'finance'
  | 'report'
  | 'system'

export interface PermissionItem {
  code: AppPermission | string
  label: string
  description: string
  group: PermissionGroup
}

export const PERMISSION_GROUP_CONFIG: Record<
  PermissionGroup,
  { label: string; badgeTone: 'emerald' | 'blue' | 'purple' | 'amber' | 'slate' }
> = {
  appointment: { label: 'Lịch hẹn & Tiếp đón', badgeTone: 'blue' },
  patient: { label: 'Hồ sơ Bệnh nhân', badgeTone: 'emerald' },
  clinical: { label: 'Khám bệnh & Bệnh án', badgeTone: 'purple' },
  operation: { label: 'Vận hành & Cơ sở vật chất', badgeTone: 'emerald' },
  service: { label: 'Chuyên môn & Dịch vụ', badgeTone: 'blue' },
  finance: { label: 'Tài chính & Thu phí', badgeTone: 'amber' },
  report: { label: 'Báo cáo & Thống kê', badgeTone: 'purple' },
  system: { label: 'Nhân sự & Hệ thống', badgeTone: 'slate' },
}

export const PERMISSION_CATALOG: PermissionItem[] = [
  // 1. Lịch hẹn
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
    description: 'Quét mã QR vé hẹn / CCCD, phân bổ phòng khám và đưa bệnh nhân vào hàng đợi bác sĩ.',
    group: 'appointment',
  },
  {
    code: AppPermission.APPOINTMENT_CANCEL,
    label: 'Hủy lịch hẹn của bệnh nhân',
    description: 'Thực hiện thao tác hủy ca hẹn và hoàn tiền / hủy giữ chỗ slot khám.',
    group: 'appointment',
  },

  // 2. Bệnh nhân & Hồ sơ y tế
  {
    code: AppPermission.PATIENT_READ,
    label: 'Xem hồ sơ & thông tin bệnh nhân',
    description: 'Tra cứu thông tin cá nhân, nhân thân, số CCCD và lịch sử bệnh nhân.',
    group: 'patient',
  },
  {
    code: AppPermission.PATIENT_MANAGE,
    label: 'Tạo mới & cập nhật hồ sơ bệnh nhân',
    description: 'Đăng ký thông tin bệnh nhân mới hoặc chỉnh sửa hồ sơ y tế hành chính.',
    group: 'patient',
  },
  {
    code: AppPermission.CLINICAL_READ,
    label: 'Xem hồ sơ bệnh án & lịch sử ca khám',
    description: 'Tra cứu tiền sử bệnh, kết quả cận lâm sàng và các đơn thuốc trước đó của bệnh nhân.',
    group: 'clinical',
  },
  {
    code: AppPermission.CLINICAL_WRITE,
    label: 'Khám bệnh, chẩn đoán & kê đơn thuốc',
    description: 'Thực hiện phiên khám lâm sàng, nhập chẩn đoán ICD-10, kê đơn thuốc và chỉ định xét nghiệm.',
    group: 'clinical',
  },

  // 3. Vận hành chi nhánh & Cơ sở vật chất
  {
    code: AppPermission.BRANCH_READ,
    label: 'Xem thông tin cơ sở & chi nhánh',
    description: 'Xem danh sách các cơ sở, phòng khám trực thuộc và thông số chi nhánh.',
    group: 'operation',
  },
  {
    code: AppPermission.BRANCH_MANAGE,
    label: 'Quản lý cơ sở & chi nhánh',
    description: 'Tạo mới, chỉnh sửa thông tin chi nhánh, địa chỉ và thiết lập chi nhánh.',
    group: 'operation',
  },
  {
    code: AppPermission.ROOM_MANAGE,
    label: 'Điều phối & cấu hình phòng khám',
    description: 'Gán chuyên khoa cho phòng khám, theo dõi tải phòng khám và trạng thái phòng.',
    group: 'operation',
  },
  {
    code: AppPermission.SCHEDULE_READ,
    label: 'Xem lịch làm việc & ca trực',
    description: 'Tra cứu lịch làm việc của bác sĩ, theo dõi ca trực và khung giờ khám.',
    group: 'operation',
  },
  {
    code: AppPermission.SCHEDULE_MANAGE,
    label: 'Xếp lịch làm việc & phân ca trực',
    description: 'Phân ca trực bác sĩ, mở hoặc đóng các khung giờ khám (slots) theo ngày.',
    group: 'operation',
  },

  // 4. Chuyên môn & Dịch vụ y tế
  {
    code: AppPermission.SPECIALTY_MANAGE,
    label: 'Quản lý danh mục chuyên khoa',
    description: 'Thêm, sửa, kích hoạt hoặc ẩn các chuyên khoa khám bệnh.',
    group: 'service',
  },
  {
    code: AppPermission.SERVICE_MANAGE,
    label: 'Quản lý danh mục dịch vụ & bảng giá',
    description: 'Cấu hình danh mục dịch vụ khám, gói khám sức khỏe và định giá viện phí.',
    group: 'service',
  },

  // 5. Tài chính & Hóa đơn
  {
    code: AppPermission.FINANCE_COLLECT,
    label: 'Thu viện phí & xuất hóa đơn tại quầy',
    description: 'Thu tiền mặt / quét mã VietQR, thẻ POS và in hóa đơn thanh toán viện phí.',
    group: 'finance',
  },
  {
    code: AppPermission.FINANCE_READ,
    label: 'Xem báo cáo tài chính & doanh thu',
    description: 'Truy cập biểu đồ doanh thu theo ngày, tuần, tháng và dòng tiền viện phí.',
    group: 'finance',
  },

  // 6. Báo cáo & Thống kê
  {
    code: AppPermission.REPORT_BRANCH_READ,
    label: 'Xem báo cáo hoạt động chi nhánh',
    description: 'Xem số liệu thống kê lượt khám, hiệu suất và hoạt động tại chi nhánh mình.',
    group: 'report',
  },
  {
    code: AppPermission.REPORT_SYSTEM_READ,
    label: 'Xem báo cáo tổng hợp toàn hệ thống',
    description: 'Báo cáo tổng quan đa chi nhánh, thống kê tăng trưởng và phân tích toàn diện.',
    group: 'report',
  },

  // 7. Nhân sự & Phân quyền
  {
    code: AppPermission.USER_READ,
    label: 'Xem danh sách tài khoản & nhân sự',
    description: 'Xem thông tin cơ sở, chuyên môn và thông tin liên hệ của nhân sự phòng khám.',
    group: 'system',
  },
  {
    code: AppPermission.USER_MANAGE,
    label: 'Quản lý tài khoản nhân viên',
    description: 'Tạo tài khoản nhân viên, khóa/mở khóa tài khoản và cập nhật hồ sơ nhân sự.',
    group: 'system',
  },
  {
    code: AppPermission.ROLE_MANAGE,
    label: 'Quản lý vai trò & phân quyền (RBAC)',
    description: 'Cấu hình quyền hạn chi tiết, cấp hoặc tước quyền tùy biến cho từng nhân sự.',
    group: 'system',
  },

  // 8. Cấu hình Hệ thống
  {
    code: AppPermission.SYSTEM_CONFIG_MANAGE,
    label: 'Cấu hình thông số hệ thống',
    description: 'Cài đặt hình thức đặt khám, thông số phòng khám và cấu hình ứng dụng.',
    group: 'system',
  },
]

export const ROLE_DEFAULT_PERMISSIONS: Record<string, AppPermission[]> = {
  admin: Object.values(AppPermission),
  branch_manager: [
    AppPermission.APPOINTMENT_READ,
    AppPermission.APPOINTMENT_CREATE,
    AppPermission.APPOINTMENT_CHECKIN,
    AppPermission.APPOINTMENT_CANCEL,
    AppPermission.PATIENT_READ,
    AppPermission.PATIENT_MANAGE,
    AppPermission.CLINICAL_READ,
    AppPermission.BRANCH_READ,
    AppPermission.ROOM_MANAGE,
    AppPermission.SCHEDULE_READ,
    AppPermission.SCHEDULE_MANAGE,
    AppPermission.SPECIALTY_MANAGE,
    AppPermission.SERVICE_MANAGE,
    AppPermission.FINANCE_READ,
    AppPermission.REPORT_BRANCH_READ,
    AppPermission.USER_READ,
  ],
  doctor: [
    AppPermission.APPOINTMENT_READ,
    AppPermission.PATIENT_READ,
    AppPermission.CLINICAL_READ,
    AppPermission.CLINICAL_WRITE,
    AppPermission.SCHEDULE_READ,
  ],
  receptionist: [
    AppPermission.APPOINTMENT_READ,
    AppPermission.APPOINTMENT_CREATE,
    AppPermission.APPOINTMENT_CHECKIN,
    AppPermission.APPOINTMENT_CANCEL,
    AppPermission.PATIENT_READ,
    AppPermission.PATIENT_MANAGE,
    AppPermission.BRANCH_READ,
    AppPermission.SCHEDULE_READ,
    AppPermission.FINANCE_COLLECT,
  ],
  patient: [
    AppPermission.APPOINTMENT_READ,
    AppPermission.APPOINTMENT_CREATE,
    AppPermission.CLINICAL_READ,
    AppPermission.SCHEDULE_READ,
  ],
}

export interface CustomPermissionsPayload {
  granted?: string[]
  revoked?: string[]
}

// Cache sẵn toàn bộ quyền hợp lệ một lần duy nhất trong RAM (Zero allocation khi gọi hàm)
export const ALL_APP_PERMISSIONS = Object.freeze(Object.values(AppPermission)) as readonly AppPermission[]
export const VALID_PERMISSIONS_SET = new Set<string>(ALL_APP_PERMISSIONS)

/**
 * Tính toán danh sách quyền hiệu lực của người dùng (Tối ưu hóa O(1), tự động dọn quyền rác)
 */
export function calculateEffectivePermissions(
  role?: string | null,
  customPermissions?: CustomPermissionsPayload | string[] | any,
): AppPermission[] {
  const normalizedRole = String(role || 'patient').toLowerCase()

  // 1. Admin luôn có toàn bộ quyền (sao chép mảng cache an toàn, cực nhanh)
  if (normalizedRole === 'admin') {
    return [...ALL_APP_PERMISSIONS]
  }

  // 2. Lấy bộ quyền cơ sở theo vai trò (chỉ lấy các quyền còn hợp lệ)
  const defaultList = ROLE_DEFAULT_PERMISSIONS[normalizedRole] || []
  const effectiveSet = new Set<AppPermission>()
  for (const perm of defaultList) {
    if (VALID_PERMISSIONS_SET.has(perm)) {
      effectiveSet.add(perm as AppPermission)
    }
  }

  // 3. Chuẩn hóa payload customPermissions (hỗ trợ cả object lẫn stringified JSON)
  let payload = customPermissions
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      payload = null
    }
  }

  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload)) {
      // Dạng mảng cũ: coi như danh sách granted
      for (const p of payload) {
        const code = String(p)
        if (VALID_PERMISSIONS_SET.has(code)) {
          effectiveSet.add(code as AppPermission)
        }
      }
    } else {
      // Dạng mới: Delta RBAC { granted, revoked }
      if (Array.isArray(payload.granted)) {
        for (const p of payload.granted) {
          const code = String(p)
          if (VALID_PERMISSIONS_SET.has(code)) {
            effectiveSet.add(code as AppPermission)
          }
        }
      }
      if (Array.isArray(payload.revoked)) {
        for (const p of payload.revoked) {
          effectiveSet.delete(String(p) as AppPermission)
        }
      }
    }
  }

  return Array.from(effectiveSet)
}
