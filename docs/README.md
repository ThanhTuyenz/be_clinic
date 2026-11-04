# Tài liệu backend

Hướng dẫn cài đặt, biến môi trường và vận hành nằm tại [README chính](../README.md).

## Nghiệp vụ và kiến trúc

`modules/analytics` sở hữu thu thập sự kiện search/gợi ý, xác minh nguồn và ghi nhận nguồn đặt lịch. Search, recommendations và bookings import `AnalyticsModule` tường minh. Báo cáo quản trị vẫn thuộc `modules/admin-dashboard/analytics`; các thành phần này không nằm trong `common`.

Booking online dùng chung kiểm tra slot/bác sĩ/gói cho đơn lẻ và gia đình. Tìm lịch mặc định 30 ngày, tối đa 60 ngày; checkout cũng kiểm tra trần 60 ngày. Không nhận đặt online trong ngày; từ 16h30 Việt Nam chỉ nhận từ ngày mốt. Tiếp nhận tại quầy giữ quy tắc riêng cho phép lịch trong ngày. Cả hai luồng dùng chung SQL giữ chỗ nguyên tử; đơn gia đình vẫn tạo một hóa đơn và tính phí dịch vụ một lần. Xung đột Prisma `P2002`/`P2034` trả HTTP 409 cho cả đơn lẻ và gia đình.

Appointments dùng transaction Serializable cho các thao tác hủy/đổi trạng thái/đổi lịch; xung đột `P2002`/`P2034` trả 409 để tải lại và thử lại. Đổi lịch kiểm tra trùng giờ với lịch khác của cùng bệnh nhân, loại trừ chính lịch đang đổi, và kiểm tra hình thức khám đã lưu cho cả bệnh nhân lẫn nhân viên. Chuyển slot dùng helper giữ chỗ của bookings và tái sử dụng slot vừa đọc trong transaction để tính số thứ tự. Khi hủy HOLD chưa thanh toán, voucher được trả lại một lần; với đơn gia đình chỉ trả khi tất cả thành viên đã hủy. Voucher của đơn đã thanh toán được giữ nguyên. Giới hạn đổi lịch của bệnh nhân vẫn là 2 lần, trước giờ khám ít nhất 6 giờ hoặc trong ân hạn 30 phút sau khi đặt.

- [Danh mục cơ sở, chuyên khoa, gói khám](../src/modules/catalog/README.md).
- [Tìm kiếm](../src/modules/search/README.md).
- [Gợi ý theo hồ sơ và hành vi](../src/modules/recommendations/README.md).
- [Phân quyền](../src/modules/auth/permissions/README.md).
- [Chatbot và thao tác lịch hẹn](ai-chat-checkout.md).
- [Thanh toán PayOS và đối soát](payment-background-demo.md).
- [Dữ liệu demo](demo-seed.md).
- [Rà soát schema database](database-schema-audit.md): báo cáo rà soát, cần đối chiếu schema hiện tại trước khi áp dụng.

API được mô tả từ controller bằng Swagger tại `/docs` (đối chiếu cấu hình bootstrap trong `src/main.ts`). Không duy trì bản danh sách Postman thủ công đã lỗi thời.

## Kiểm tra backend

```powershell
npx tsc --noEmit
npm run build
```

TypeScript đã bật `noUnusedLocals` và `noUnusedParameters`; dùng `npm run check` để kiểm tra nhanh. Khi cần quét thêm file/export/dependency thừa, chạy `npx --yes knip --config knip.json`. Entry point bao gồm bootstrap NestJS, khai báo kiểu Express, Prisma và các script vận hành. Kết quả là dấu hiệu cần đối chiếu, không dùng chế độ tự xóa.

Thư mục `scripts/` giữ ba công cụ vận hành:

- `sync-redis-search.mjs`: đồng bộ chỉ mục/vector tìm kiếm.
- `verify-demo-seed.mjs`: xác minh dữ liệu sau seed.
- `reconcile-payos-payment.mjs`: đối soát giao dịch PayOS theo tham số truyền vào.

Các script test, benchmark, xuất báo cáo và chuyển đổi dữ liệu cũ đã được dọn. Bộ test UI nằm trong `../e2e/`; xem README của bộ test để chọn project và chuẩn bị database phù hợp.

Ảnh, video, trace và HTML report của Playwright là đầu ra sinh lại được trong `../e2e/artifacts/`. Cấu hình mặc định giữ video/trace khi test lỗi; dùng `PW_RECORD_ALL=1` khi cần ghi lại toàn bộ. Bản sao source để hoàn tác nằm trong `../e2e/backups/`.
