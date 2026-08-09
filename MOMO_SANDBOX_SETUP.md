# MoMo Sandbox

## Cấu hình

Thêm vào `.env.development` (không commit secret thật):

```env
MOMO_PARTNER_CODE=<sandbox-partner-code>
MOMO_ACCESS_KEY=<sandbox-access-key>
MOMO_SECRET_KEY=<sandbox-secret-key>
MOMO_CREATE_ENDPOINT=https://test-payment.momo.vn/v2/gateway/api/create
MOMO_REDIRECT_URL=http://localhost:3000/thanh-toan/momo-ket-qua
MOMO_IPN_URL=https://<public-backend>/api/v1/payments/momo/ipn
```

`MOMO_IPN_URL` phải là HTTPS URL mà máy chủ MoMo truy cập được. Khi chạy local,
dùng tunnel HTTPS và trỏ tunnel vào cổng backend.

## Endpoint

- `POST /api/v1/payments/momo/create`: tạo phiên thanh toán cho `paymentId` thuộc người dùng hiện tại.
- `POST /api/v1/payments/momo/ipn`: nhận IPN, xác thực HMAC-SHA256, đối chiếu merchant/order/amount và cập nhật giao dịch idempotent.
- `GET /api/v1/appointments/:id/payment-status`: frontend xác minh trạng thái sau khi MoMo redirect.

Redirect từ trình duyệt không được dùng để xác nhận đã thanh toán. Chỉ IPN hợp lệ
(hoặc một truy vấn trạng thái server-to-server được bổ sung sau này) mới cập nhật
invoice thành `PAID` và appointment thành `BOOKED`.
