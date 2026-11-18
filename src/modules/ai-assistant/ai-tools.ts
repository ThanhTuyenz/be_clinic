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
  tool('showMyAppointments', 'Hiển thị các thẻ lịch hẹn ngay trong chat để người dùng xem, hủy hoặc đổi lịch. Yêu cầu đăng nhập và bấm xác nhận trên giao diện; tool này không thay đổi lịch.', {}),
  tool('searchServicePackages', 'Tìm gói khám/dịch vụ và giá thực tế theo tên hoặc từ khóa người dùng yêu cầu tìm. Không dùng để suy luận bệnh hay chọn chuyên khoa từ triệu chứng.', {
    query: { type: 'string' }, branchId: text, specialtyId: text,
  }),
  tool('searchDoctors', 'Tìm bác sĩ theo tên, chuyên khoa, cơ sở và hình thức khám do người dùng nêu rõ. query chỉ chứa tên bác sĩ, không chứa chuyên khoa hoặc toàn bộ câu hỏi. Khi người dùng nêu chuyên khoa, bắt buộc điền specialtyId từ danh mục hoặc specialtyName đúng tên người dùng nêu; không bỏ cả hai thành null. Không tự chọn chuyên khoa theo triệu chứng. Bao gồm tìm bác sĩ tư vấn trực tuyến.', {
    query: text, branchId: text, specialtyId: text, specialtyName: text,
    bookingMethodCode: { type: 'string', enum: ['CONSULTATION', 'ONLINE_CONSULTATION'] },
  }),
  tool('getClinicInfoAndPolicies', 'Tra cứu địa chỉ, hotline, email, giờ mở cửa từng cơ sở và FAQ chính sách hủy/đổi lịch, hoàn tiền, bảo hiểm, thanh toán.', {
    branchName: text,
    topic: { type: 'string', enum: ['BRANCHES', 'REFUND_CANCEL', 'INSURANCE', 'PAYMENT_BOOKING', 'ALL'] },
  }),
];
