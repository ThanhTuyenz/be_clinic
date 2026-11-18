# Phân quyền backend

Hệ thống dùng RBAC với quyền dạng chuỗi, ví dụ `user:read`, `service:update`.

- `constants/permissions.constant.ts`: `AppPermission`, danh mục quyền, quyền mặc định theo vai trò và hàm tính quyền hiệu lực.
- `permissions.service.ts`: đọc vai trò/quyền tùy chỉnh từ database và cache kết quả.
- `guards/permissions.guard.ts`: guard toàn cục, thực thi metadata trên controller/handler.
- `permissions.controller.ts`: danh mục quyền, quyền của tài khoản hiện tại và quyền của nhân sự.

## Khai báo quyền

```ts
@RequirePermissions(AppPermission.USER_READ)
```

Guard yêu cầu đủ tất cả quyền được khai báo. Quyền hiệu lực được tính từ vai trò và `customPermissions`; đối chiếu hàm `calculateEffectivePermissions` khi thay đổi chính sách.

- `@Public()` dành cho endpoint công khai.
- `@SkipPermissions()` bỏ yêu cầu quyền nguyên tử khi handler không khai báo `@RequirePermissions`; không thay thế xác thực đăng nhập.
- `@ExcludeRoles(...)` vẫn được kiểm tra trên endpoint cần xác thực, kể cả khi có `@SkipPermissions()`.
- Phạm vi chi nhánh, quyền sở hữu hồ sơ và lịch hẹn vẫn được kiểm tra tại service nghiệp vụ.

Không còn dùng mô hình permission cũ gồm `action`, `effect`, `resourceTarget` hoặc `request.permissionsContext`.

## API

- `GET /permissions/catalog`: danh mục quyền và mặc định theo vai trò.
- `GET /permissions/me`: quyền hiệu lực của tài khoản hiện tại.
- `GET /permissions/user/:id`: cần quyền `user:read`.

Các đường dẫn trên được ghép với API prefix/version của ứng dụng. Swagger tại `/docs` là nguồn tra cứu endpoint và DTO hiện tại.
