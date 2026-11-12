import type { FunctionTool } from 'openai/resources/responses/responses';

const text = { type: ['string', 'null'] };
const tool = (name: string, description: string, properties: Record<string, unknown>): FunctionTool => ({
  type: 'function', name, description, strict: true,
  parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
});

export const AI_TOOLS = [
  tool('getMyPaymentStatus', 'Tra cứu thanh toán/hoàn tiền của lịch hẹn thuộc tài khoản đang đăng nhập. Chỉ dùng mã lịch hẹn hoặc UUID người dùng cung cấp; không đoán ID. Chưa rõ lịch nào thì truyền null để mở danh sách chọn. refresh true đồng bộ giao dịch chờ với PayOS khi cần.', {
    appointmentReference: text, refresh: { type: 'boolean' },
  }),
  tool('showMyAppointments', 'Mở danh sách lịch hẹn trong chat để người dùng xem, hủy hoặc đổi lịch. Yêu cầu đăng nhập và bấm xác nhận trên giao diện; tool này không thay đổi lịch.', {}),
  tool('searchServicePackages', 'Tìm gói khám/dịch vụ và giá thực tế theo từ khóa.', {
    query: { type: 'string' }, branchId: text, specialtyId: text,
  }),
  tool('searchDoctors', 'Tìm bác sĩ theo tên, chuyên khoa, cơ sở và hình thức khám.', {
    query: text, branchId: text, specialtyId: text,
    bookingMethodCode: { type: 'string', enum: ['CONSULTATION', 'ONLINE_CONSULTATION'] },
  }),
];
