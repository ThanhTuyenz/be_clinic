export enum AppPermission {
  USER_READ = 'user:read',
  USER_CREATE = 'user:create',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  BRANCH_READ = 'branch:read',
  BRANCH_CREATE = 'branch:create',
  BRANCH_UPDATE = 'branch:update',
  BRANCH_DELETE = 'branch:delete',
  ROOM_READ = 'room:read',
  ROOM_CREATE = 'room:create',
  ROOM_UPDATE = 'room:update',
  ROOM_DELETE = 'room:delete',
  SPECIALTY_READ = 'specialty:read',
  SPECIALTY_CREATE = 'specialty:create',
  SPECIALTY_UPDATE = 'specialty:update',
  SPECIALTY_DELETE = 'specialty:delete',
  SERVICE_READ = 'service:read',
  SERVICE_CREATE = 'service:create',
  SERVICE_UPDATE = 'service:update',
  SERVICE_DELETE = 'service:delete',
  BOOKING_METHOD_READ = 'booking_method:read',
  BOOKING_METHOD_CREATE = 'booking_method:create',
  BOOKING_METHOD_UPDATE = 'booking_method:update',
  BOOKING_METHOD_DELETE = 'booking_method:delete',
  SCHEDULE_READ = 'schedule:read',
  SCHEDULE_CREATE = 'schedule:create',
  SCHEDULE_UPDATE = 'schedule:update',
  SCHEDULE_DELETE = 'schedule:delete',
  PATIENT_READ = 'patient:read',
  PATIENT_CREATE = 'patient:create',
  PATIENT_UPDATE = 'patient:update',
  APPOINTMENT_READ = 'appointment:read',
  APPOINTMENT_CREATE = 'appointment:create',
  APPOINTMENT_CHECKIN = 'appointment:checkin',
  APPOINTMENT_CANCEL = 'appointment:cancel',
  CLINICAL_READ = 'clinical:read',
  CLINICAL_WRITE = 'clinical:write',
  FINANCE_READ = 'finance:read',
  FINANCE_COLLECT = 'finance:collect',
  REPORT_BRANCH_READ = 'report:branch_read',
  REPORT_SYSTEM_READ = 'report:system_read',
  ROLE_MANAGE = 'role:manage',
  INTEGRATION_READ = 'integration:read',
  INTEGRATION_VERIFY = 'integration:verify',
  SYSTEM_LOG_READ = 'system_log:read',
  // Compatibility only: not shown in the current permission catalog.
  USER_MANAGE = 'user:manage',
  BRANCH_MANAGE = 'branch:manage',
  ROOM_MANAGE = 'room:manage',
  SPECIALTY_MANAGE = 'specialty:manage',
  SERVICE_MANAGE = 'service:manage',
  SCHEDULE_MANAGE = 'schedule:manage',
  PATIENT_MANAGE = 'patient:manage',
  SYSTEM_CONFIG_MANAGE = 'system:config_manage',
}
export type PermissionGroup = 'appointment' | 'patient' | 'clinical' | 'operation' | 'service' | 'finance' | 'report' | 'system'
export interface PermissionItem { code: AppPermission | string; label: string; description: string; group: PermissionGroup }
export const PERMISSION_GROUP_CONFIG: Record<PermissionGroup, { label: string; badgeTone: 'emerald' | 'blue' | 'purple' | 'amber' | 'slate' }> = {
  appointment: { label: 'Lịch hẹn & Tiếp đón', badgeTone: 'blue' },
  patient: { label: 'Hồ sơ Bệnh nhân', badgeTone: 'emerald' },
  clinical: { label: 'Khám bệnh & Bệnh án', badgeTone: 'purple' },
  operation: { label: 'Vận hành & Cơ sở vật chất', badgeTone: 'emerald' },
  service: { label: 'Chuyên môn & Dịch vụ', badgeTone: 'blue' },
  finance: { label: 'Tài chính & Thu phí', badgeTone: 'amber' },
  report: { label: 'Thống kê', badgeTone: 'purple' },
  system: { label: 'Nhân sự & Hệ thống', badgeTone: 'slate' },
}
export const PERMISSION_CATALOG: PermissionItem[] = [
  { code: AppPermission.USER_READ, label: "Xem tài khoản", description: "Xem tài khoản trong phạm vi được phân công.", group: 'system' },
  { code: AppPermission.USER_CREATE, label: "Tạo tài khoản", description: "Tạo tài khoản trong phạm vi được phân công.", group: 'system' },
  { code: AppPermission.USER_UPDATE, label: "Cập nhật tài khoản", description: "Cập nhật thông tin và khóa/mở khóa tài khoản. Đổi vai trò hoặc cấp quyền yêu cầu role:manage.", group: 'system' },
  { code: AppPermission.USER_DELETE, label: "Xóa / ngừng sử dụng tài khoản", description: "Xóa / ngừng sử dụng tài khoản trong phạm vi được phân công.", group: 'system' },
  { code: AppPermission.BRANCH_READ, label: "Xem chi nhánh", description: "Xem chi nhánh trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.BRANCH_CREATE, label: "Tạo chi nhánh", description: "Tạo chi nhánh trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.BRANCH_UPDATE, label: "Cập nhật chi nhánh", description: "Cập nhật chi nhánh trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.BRANCH_DELETE, label: "Xóa / ngừng sử dụng chi nhánh", description: "Xóa / ngừng sử dụng chi nhánh trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.ROOM_READ, label: "Xem phòng khám", description: "Xem phòng khám trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.ROOM_CREATE, label: "Tạo phòng khám", description: "Tạo phòng khám trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.ROOM_UPDATE, label: "Cập nhật phòng khám", description: "Cập nhật phòng khám trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.ROOM_DELETE, label: "Xóa / ngừng sử dụng phòng khám", description: "Xóa / ngừng sử dụng phòng khám trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.SPECIALTY_READ, label: "Xem chuyên khoa", description: "Xem chuyên khoa trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.SPECIALTY_CREATE, label: "Tạo chuyên khoa", description: "Tạo chuyên khoa trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.SPECIALTY_UPDATE, label: "Cập nhật chuyên khoa", description: "Cập nhật chuyên khoa trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.SPECIALTY_DELETE, label: "Xóa / ngừng sử dụng chuyên khoa", description: "Xóa / ngừng sử dụng chuyên khoa trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.SERVICE_READ, label: "Xem dịch vụ & gói khám", description: "Xem dịch vụ & gói khám trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.SERVICE_CREATE, label: "Tạo dịch vụ & gói khám", description: "Tạo dịch vụ & gói khám trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.SERVICE_UPDATE, label: "Cập nhật dịch vụ & gói khám", description: "Cập nhật dịch vụ & gói khám trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.SERVICE_DELETE, label: "Xóa / ngừng sử dụng dịch vụ & gói khám", description: "Xóa / ngừng sử dụng dịch vụ & gói khám trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.BOOKING_METHOD_READ, label: "Xem hình thức đặt khám", description: "Xem hình thức đặt khám trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.BOOKING_METHOD_CREATE, label: "Tạo hình thức đặt khám", description: "Tạo hình thức đặt khám trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.BOOKING_METHOD_UPDATE, label: "Cập nhật hình thức đặt khám", description: "Cập nhật hình thức đặt khám trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.BOOKING_METHOD_DELETE, label: "Xóa / ngừng sử dụng hình thức đặt khám", description: "Xóa / ngừng sử dụng hình thức đặt khám trong phạm vi được phân công.", group: 'service' },
  { code: AppPermission.SCHEDULE_READ, label: "Xem lịch làm việc", description: "Xem lịch làm việc trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.SCHEDULE_CREATE, label: "Tạo lịch làm việc", description: "Tạo lịch làm việc trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.SCHEDULE_UPDATE, label: "Cập nhật lịch làm việc", description: "Cập nhật lịch làm việc trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.SCHEDULE_DELETE, label: "Xóa / ngừng sử dụng lịch làm việc", description: "Xóa / ngừng sử dụng lịch làm việc trong phạm vi được phân công.", group: 'operation' },
  { code: AppPermission.PATIENT_READ, label: "Xem hồ sơ bệnh nhân", description: "Xem hồ sơ bệnh nhân trong phạm vi được phân công.", group: 'patient' },
  { code: AppPermission.PATIENT_CREATE, label: "Tạo hồ sơ bệnh nhân", description: "Tạo hồ sơ bệnh nhân trong phạm vi được phân công.", group: 'patient' },
  { code: AppPermission.PATIENT_UPDATE, label: "Cập nhật hồ sơ bệnh nhân", description: "Cập nhật hồ sơ bệnh nhân trong phạm vi được phân công.", group: 'patient' },
  { code: AppPermission.APPOINTMENT_READ, label: "Xem lịch hẹn", description: "Xem danh sách và chi tiết lịch hẹn.", group: 'appointment' },
  { code: AppPermission.APPOINTMENT_CREATE, label: "Tạo lịch hẹn", description: "Đặt lịch khám cho bệnh nhân.", group: 'appointment' },
  { code: AppPermission.APPOINTMENT_CHECKIN, label: "Tiếp nhận bệnh nhân", description: "Xác nhận check-in và cấp số chờ khám.", group: 'appointment' },
  { code: AppPermission.APPOINTMENT_CANCEL, label: "Hủy lịch hẹn", description: "Hủy lịch theo quy trình nghiệp vụ.", group: 'appointment' },
  { code: AppPermission.CLINICAL_READ, label: "Xem bệnh án", description: "Xem hồ sơ bệnh án và lịch sử khám.", group: 'clinical' },
  { code: AppPermission.FINANCE_READ, label: "Xem giao dịch & doanh thu", description: "Xem hóa đơn và thống kê tài chính.", group: 'finance' },
  { code: AppPermission.FINANCE_COLLECT, label: "Thu phí & xuất hóa đơn", description: "Thu viện phí tại quầy.", group: 'finance' },
  { code: AppPermission.REPORT_BRANCH_READ, label: "Xem thống kê chi nhánh", description: "Xem thống kê tại chi nhánh được phân công.", group: 'report' },
  { code: AppPermission.REPORT_SYSTEM_READ, label: "Xem thống kê toàn chuỗi", description: "Xem thống kê tổng hợp tất cả chi nhánh.", group: 'report' },
  { code: AppPermission.ROLE_MANAGE, label: "Quản lý vai trò & phân quyền", description: "Đổi vai trò, cấp thêm và thu hồi quyền. Không gộp vào sửa tài khoản.", group: 'system' },
  { code: AppPermission.INTEGRATION_READ, label: "Xem cấu hình tích hợp", description: "Xem trạng thái cấu hình tích hợp; vẫn giới hạn vai trò Admin.", group: 'system' },
  { code: AppPermission.INTEGRATION_VERIFY, label: "Kiểm tra kết nối tích hợp", description: "Kiểm tra kết nối SMTP; không gửi email và không sửa khóa.", group: 'system' },
  { code: AppPermission.SYSTEM_LOG_READ, label: "Xem nhật ký hệ thống", description: "Xem audit log, lịch sử đăng nhập và lỗi hệ thống.", group: 'system' },
]
export const LEGACY_PERMISSION_MAP: Record<string, readonly string[]> = {
  "clinical:write": [],
  "user:manage": [
    "user:create",
    "user:update",
    "user:delete"
  ],
  "branch:manage": [
    "branch:create",
    "branch:update",
    "branch:delete"
  ],
  "room:manage": [
    "room:create",
    "room:update",
    "room:delete"
  ],
  "specialty:manage": [
    "specialty:create",
    "specialty:update",
    "specialty:delete"
  ],
  "service:manage": [
    "service:create",
    "service:update",
    "service:delete"
  ],
  "schedule:manage": [
    "schedule:create",
    "schedule:update",
    "schedule:delete"
  ],
  "patient:manage": [
    "patient:create",
    "patient:update"
  ],
  "system:config_manage": [
    "integration:read",
    "integration:verify",
    "system_log:read"
  ]
}
export const ALL_APP_PERMISSIONS = Object.freeze(PERMISSION_CATALOG.map((item) => item.code as AppPermission))
export const VALID_PERMISSIONS_SET = new Set<string>(ALL_APP_PERMISSIONS)

const SCHEDULE_WRITE_PERMISSIONS = [
  AppPermission.SCHEDULE_CREATE,
  AppPermission.SCHEDULE_UPDATE,
  AppPermission.SCHEDULE_DELETE,
]

const CHAIN_MANAGER_RESTRICTED_PERMISSIONS = [
  ...SCHEDULE_WRITE_PERMISSIONS,
  AppPermission.APPOINTMENT_CREATE,
  AppPermission.APPOINTMENT_CHECKIN,
  AppPermission.APPOINTMENT_CANCEL,
  AppPermission.PATIENT_READ,
  AppPermission.PATIENT_CREATE,
  AppPermission.PATIENT_UPDATE,
  AppPermission.CLINICAL_READ,
  AppPermission.CLINICAL_WRITE,
  AppPermission.FINANCE_READ,
  AppPermission.FINANCE_COLLECT,
]

export const ROLE_DEFAULT_PERMISSIONS: Record<string, AppPermission[]> = {
  admin: [AppPermission.USER_READ, AppPermission.USER_CREATE, AppPermission.USER_UPDATE, AppPermission.USER_DELETE, AppPermission.ROLE_MANAGE, AppPermission.INTEGRATION_READ, AppPermission.INTEGRATION_VERIFY, AppPermission.SYSTEM_LOG_READ, AppPermission.BRANCH_READ, AppPermission.ROOM_READ, AppPermission.SPECIALTY_READ, AppPermission.SERVICE_READ, AppPermission.BOOKING_METHOD_READ, AppPermission.SCHEDULE_READ, ...SCHEDULE_WRITE_PERMISSIONS],
  chain_manager: ALL_APP_PERMISSIONS.filter((p) => ![
    ...CHAIN_MANAGER_RESTRICTED_PERMISSIONS,
    AppPermission.USER_CREATE, AppPermission.USER_UPDATE, AppPermission.USER_DELETE, AppPermission.ROLE_MANAGE, AppPermission.INTEGRATION_READ, AppPermission.INTEGRATION_VERIFY, AppPermission.SYSTEM_LOG_READ
  ].includes(p)),
  branch_manager: [AppPermission.APPOINTMENT_READ, AppPermission.APPOINTMENT_CREATE, AppPermission.APPOINTMENT_CHECKIN, AppPermission.APPOINTMENT_CANCEL, AppPermission.PATIENT_READ, AppPermission.PATIENT_CREATE, AppPermission.PATIENT_UPDATE, AppPermission.CLINICAL_READ, AppPermission.BRANCH_READ, AppPermission.ROOM_READ, AppPermission.SPECIALTY_READ, AppPermission.SERVICE_READ, AppPermission.BOOKING_METHOD_READ, AppPermission.SCHEDULE_READ, AppPermission.BRANCH_UPDATE, AppPermission.ROOM_CREATE, AppPermission.ROOM_UPDATE, AppPermission.ROOM_DELETE, AppPermission.SCHEDULE_CREATE, AppPermission.SCHEDULE_UPDATE, AppPermission.SCHEDULE_DELETE, AppPermission.SPECIALTY_UPDATE, AppPermission.SERVICE_UPDATE, AppPermission.FINANCE_READ, AppPermission.REPORT_BRANCH_READ, AppPermission.USER_READ],
  doctor: [AppPermission.APPOINTMENT_READ, AppPermission.PATIENT_READ, AppPermission.CLINICAL_READ, AppPermission.BRANCH_READ, AppPermission.ROOM_READ, AppPermission.SPECIALTY_READ, AppPermission.SERVICE_READ, AppPermission.BOOKING_METHOD_READ, AppPermission.SCHEDULE_READ],
  receptionist: [AppPermission.APPOINTMENT_READ, AppPermission.APPOINTMENT_CREATE, AppPermission.APPOINTMENT_CHECKIN, AppPermission.APPOINTMENT_CANCEL, AppPermission.PATIENT_READ, AppPermission.PATIENT_CREATE, AppPermission.PATIENT_UPDATE, AppPermission.BRANCH_READ, AppPermission.ROOM_READ, AppPermission.SPECIALTY_READ, AppPermission.SERVICE_READ, AppPermission.BOOKING_METHOD_READ, AppPermission.SCHEDULE_READ, AppPermission.FINANCE_COLLECT],
  patient: [AppPermission.APPOINTMENT_READ, AppPermission.APPOINTMENT_CREATE, AppPermission.PATIENT_READ, AppPermission.PATIENT_CREATE, AppPermission.PATIENT_UPDATE, AppPermission.CLINICAL_READ, AppPermission.SCHEDULE_READ],
}
export interface CustomPermissionsPayload { granted?: string[]; revoked?: string[] }

export function normalizePermissionCodes(values: unknown): AppPermission[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.flatMap((value) => LEGACY_PERMISSION_MAP[String(value)] || [String(value)]).filter((code) => VALID_PERMISSIONS_SET.has(code)))] as AppPermission[]
}
export function normalizeCustomPermissions(input: unknown): Required<CustomPermissionsPayload> {
  let payload: any = input
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { payload = null }
  }
  return {
    granted: normalizePermissionCodes(Array.isArray(payload) ? payload : payload?.granted),
    revoked: normalizePermissionCodes(Array.isArray(payload) ? [] : payload?.revoked),
  }
}
export function calculateEffectivePermissions(role?: string | null, customPermissions?: any): AppPermission[] {
  const name = String(role || 'patient').toLowerCase()
  if (name === 'admin') return [...ROLE_DEFAULT_PERMISSIONS.admin]
  const effective = new Set<AppPermission>(ROLE_DEFAULT_PERMISSIONS[name] || [])
  const payload = normalizeCustomPermissions(customPermissions)
  for (const code of payload.granted) effective.add(code as AppPermission)
  for (const code of payload.revoked) effective.delete(code as AppPermission)
  // Quản lý toàn chuỗi xem thống kê và lịch bác sĩ, không vận hành khám chữa bệnh.
  if (name === 'chain_manager') {
    for (const permission of CHAIN_MANAGER_RESTRICTED_PERMISSIONS) effective.delete(permission)
  }
  return [...effective]
}
