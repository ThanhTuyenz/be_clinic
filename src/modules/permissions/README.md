# Permissions Module - Hệ thống phân quyền

Hệ thống phân quyền RBAC (Role-Based Access Control) cấp doanh nghiệp với audit logging và caching.

## Tính năng

- **Role-Based Access Control (RBAC)**: Phân quyền chi tiết dựa trên vai trò người dùng
- **Resource-Level Permissions**: Kiểm soát quyền truy cập đến từng resource cụ thể hoặc tất cả
- **ALLOW/DENY Rules**: Hỗ trợ cả quyền cho phép và từ chối (DENY ưu tiên cao hơn)
- **Audit Logging**: Ghi log đầy đủ mọi quyết định phân quyền
- **In-Memory Caching**: Tra cứu permissions nhanh với tự động invalidate cache
- **Type-Safe**: Hỗ trợ TypeScript đầy đủ với strict typing
- **Decorator-Based**: API rõ ràng, khai báo bằng NestJS decorators
- **Dynamic Resource Targeting**: Phân quyền động dựa trên request context

## Kiến trúc

```
permissions/
├── decorators/
│   ├── permissions.decorator.ts      # @RequiresPermission decorator
│   └── skip-permissions.decorator.ts # @SkipPermissions decorator
├── guards/
│   └── permissions.guard.ts          # Guard kiểm tra permissions
├── services/
│   ├── permissions.service.ts        # Service quản lý permissions
│   ├── permissions-cache.service.ts  # Service cache permissions
│   └── audit-log.service.ts          # Service ghi audit log
├── enums/
│   ├── action.enum.ts                # Các action types
│   ├── resource-type.enum.ts         # Các resource types
│   ├── resource-target.enum.ts       # Target types (ANY, SOME)
│   ├── effect.enum.ts                # Effect types (ALLOW, DENY)
│   └── role.enum.ts                  # Permission roles
├── exceptions/
│   └── permission.exceptions.ts      # Custom exception classes
├── types/
│   └── permission.type.ts            # Permission interface
├── permissions.helpers.ts            # Helper functions
└── README.md                         # Documentation
```

### Permission Model

Mỗi permission bao gồm 4 thành phần:

```typescript
interface Permission {
  resourceType: PermissionResource;    // Loại resource (USER, BLOG, MENU...)
  action: PermissionAction;            // Hành động (GET, CREATE, EDIT, DELETE)
  resourceTarget: string;              // Target cụ thể (UUID, ANY, SOME)
  effect: PermissionEffect;            // ALLOW hoặc DENY
}
```

## Vai trò (Roles)

Hệ thống hỗ trợ 4 vai trò với phân quyền phân cấp:

| Role | Mô tả | Permissions |
|------|-------|-------------|
| `SUPER_ADMIN` | Toàn quyền hệ thống | TẤT CẢ resources, TẤT CẢ actions |
| `ADMIN` | Quản trị viên | TẤT CẢ resources, TẤT CẢ actions |
| `STAFF` | Nhân viên (quyền hạn chế) | Xem tất cả users, Chỉnh sửa một số users |
| `USER` | Người dùng thông thường | Chỉ xem/sửa resources của chính mình |

### Chi tiết permissions theo role

```typescript
// SUPER_ADMIN & ADMIN
{
  resourceType: PermissionResource.ANY,
  action: PermissionAction.ANY,
  resourceTarget: PermissionResourceTarget.ANY,
  effect: PermissionEffect.ALLOW
}
// → Toàn quyền trên tất cả resources

// STAFF
[
  {
    resourceType: PermissionResource.USER,
    action: PermissionAction.GET,
    resourceTarget: PermissionResourceTarget.ANY,
    effect: PermissionEffect.ALLOW
  },
  {
    resourceType: PermissionResource.USER,
    action: PermissionAction.EDIT,
    resourceTarget: PermissionResourceTarget.SOME,
    effect: PermissionEffect.ALLOW
  }
]
// → Xem tất cả users, chỉ edit một số users cụ thể

// USER
[
  {
    resourceType: PermissionResource.USER,
    action: PermissionAction.GET,
    resourceTarget: PermissionResourceTarget.SOME,
    effect: PermissionEffect.ALLOW
  },
  {
    resourceType: PermissionResource.USER,
    action: PermissionAction.EDIT,
    resourceTarget: PermissionResourceTarget.SOME,
    effect: PermissionEffect.ALLOW
  }
]
// → Chỉ xem và edit một số users cụ thể (thường là chính mình)
```

## Cài đặt

### 1. Import PermissionsModule

```typescript
import { Module } from '@nestjs/common';
import { PermissionsModule } from './modules/permissions/permissions.module';

@Module({
  imports: [
    PermissionsModule,
    // ... other modules
  ],
})
export class AppModule {}
```

### 2. Áp dụng PermissionsGuard globally (khuyến nghị)

```typescript
// app.module.ts
import { APP_GUARD } from '@nestjs/core';
import { PermissionsGuard } from './modules/permissions/guards/permissions.guard';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // Authentication trước
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard, // Authorization sau
    },
  ],
})
export class AppModule {}
```

## Sử dụng

### 1. Bảo vệ routes với @RequiresPermission

```typescript
import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import {
  RequiresPermission,
  PermissionResource,
  PermissionAction,
  PermissionResourceTarget,
  GetResourceIdFromParams,
} from '../permissions/decorators/permissions.decorator';

@Controller('users')
export class UsersController {
  // Cho phép xem danh sách tất cả users
  @Get()
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.GET,
    PermissionResourceTarget.ANY
  )
  findAll() {
    // Chỉ ADMIN/SUPER_ADMIN có quyền ANY
    return this.usersService.findAll();
  }

  // Cho phép xem user cụ thể (kiểm tra quyền theo ID)
  @Get(':id')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.GET,
    GetResourceIdFromParams  // Lấy ID động từ route params
  )
  findOne(@Param('id') id: string) {
    // Guard sẽ kiểm tra quyền trên user ID này
    return this.usersService.findOne(id);
  }

  // Cho phép tạo user mới
  @Post()
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.CREATE,
    PermissionResourceTarget.ANY
  )
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  // Cho phép chỉnh sửa user cụ thể
  @Patch(':id')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.EDIT,
    GetResourceIdFromParams
  )
  update(@Param('id') id: string, @Body() updateDto: UpdateUserDto) {
    return this.usersService.update(id, updateDto);
  }

  // Cho phép xóa user cụ thể
  @Delete(':id')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.DELETE,
    GetResourceIdFromParams
  )
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
```

### 2. Bỏ qua kiểm tra permissions với @SkipPermissions

Sử dụng cho public endpoints hoặc routes xử lý authorization riêng:

```typescript
import { Controller, Post, Get } from '@nestjs/common';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator';

// Áp dụng cho toàn bộ controller
@Controller('auth')
@SkipPermissions()
export class AuthController {
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }
}

// Hoặc áp dụng cho từng route
@Controller('users')
export class UsersController {
  @Get('public-info')
  @SkipPermissions()  // Chỉ route này bỏ qua permissions
  getPublicInfo() {
    return this.usersService.getPublicInfo();
  }

  @Get(':id')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.GET,
    GetResourceIdFromParams
  )
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }
}
```

### 3. Sử dụng permissions context trong service

Truy cập thông tin permissions đã được kiểm tra:

```typescript
import { Injectable } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { In, Not } from 'typeorm';

@Injectable()
export class UsersService {
  async findAll(req: ExpressRequest) {
    const { allowedResourcesIds, deniedResourcesIds } = req.permissionsContext || {};

    // USER/STAFF: chỉ lấy users được phép
    if (allowedResourcesIds) {
      return this.usersRepository.find({
        where: { id: In(allowedResourcesIds) }
      });
    }

    // ADMIN/SUPER_ADMIN: lấy tất cả trừ những users bị deny
    if (deniedResourcesIds && deniedResourcesIds.length > 0) {
      return this.usersRepository.find({
        where: { id: Not(In(deniedResourcesIds)) }
      });
    }

    // Lấy tất cả
    return this.usersRepository.find();
  }
}
```

### 4. Custom resource ID extraction

Tạo function riêng để lấy resource ID từ request:

```typescript
import { Request as ExpressRequest } from 'express';
import { BadRequestException } from '@nestjs/common';
import { validate as isUuid } from 'uuid';

// Lấy ID từ request body
function GetBlogIdFromBody(req: ExpressRequest): string {
  const blogId = req.body?.blogId;
  if (!blogId) {
    throw new BadRequestException('Missing blogId in request body');
  }
  if (!isUuid(blogId)) {
    throw new BadRequestException('Invalid blogId format');
  }
  return blogId;
}

// Lấy ID từ query params
function GetUserIdFromQuery(req: ExpressRequest): string {
  const userId = req.query?.userId as string;
  if (!userId) {
    throw new BadRequestException('Missing userId in query');
  }
  if (!isUuid(userId)) {
    throw new BadRequestException('Invalid userId format');
  }
  return userId;
}

@Controller('comments')
export class CommentsController {
  @Post()
  @RequiresPermission(
    PermissionResource.BLOG,
    PermissionAction.EDIT,
    GetBlogIdFromBody  // Custom function
  )
  createComment(@Body() createCommentDto: CreateCommentDto) {
    return this.commentsService.create(createCommentDto);
  }
}

@Controller('reports')
export class ReportsController {
  @Get('user-activity')
  @RequiresPermission(
    PermissionResource.USER,
    PermissionAction.GET,
    GetUserIdFromQuery  // Custom function
  )
  getUserActivity(@Query('userId') userId: string) {
    return this.reportsService.getUserActivity(userId);
  }
}
```

### 5. Invalidate cache khi permissions thay đổi

```typescript
import { Injectable } from '@nestjs/common';
import { PermissionsService } from '../permissions/permissions.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly permissionsService: PermissionsService,
  ) {}

  async updateUserRole(userId: string, newRole: UserRole) {
    // Cập nhật role trong database
    await this.usersRepository.update(userId, { role: newRole });

    // Xóa cache permissions của user này
    this.permissionsService.invalidateCache(userId);
  }

  async blockUser(userId: string) {
    // Block user
    await this.usersRepository.update(userId, { isBlocked: true });

    // Xóa cache sau khi block
    this.permissionsService.invalidateCache(userId);
  }

  async updateGlobalPermissionRules() {
    // Cập nhật quy tắc permissions toàn cục
    // ...

    // Xóa toàn bộ cache
    this.permissionsService.invalidateAllCache();
  }
}
```

## Permission Resources

Các loại resource được hỗ trợ:

```typescript
enum PermissionResource {
  ANY = '*',                          // Wildcard - tất cả resources
  BANNER = 'banners',                 // Quản lý banners
  BLOG = 'blogs',                     // Quản lý blogs
  CATEGORY_BLOG = 'categories-blog',  // Quản lý danh mục blog
  CONTACT = 'contacts',               // Quản lý liên hệ
  HISTORY = 'histories',              // Quản lý lịch sử
  IMAGE = 'images',                   // Quản lý hình ảnh
  INFO_WEBSITE = 'info-websites',     // Quản lý thông tin website
  MENU = 'menus',                     // Quản lý menu
  PERMISSION = 'permissions',         // Quản lý permissions
  SERVICE_PACKAGE = 'service-packages', // Quản lý gói dịch vụ
  USER = 'users'                      // Quản lý users
}
```

### Thêm resource mới

1. Thêm vào enum `PermissionResource` trong [enums/resource-type.enum.ts](enums/resource-type.enum.ts)
2. Cập nhật `generateGlobalPermissions()` trong [permissions.helpers.ts](permissions.helpers.ts) nếu cần
3. Sử dụng với decorator `@RequiresPermission` trong controller

## Permission Actions

Các hành động được hỗ trợ:

```typescript
enum PermissionAction {
  ANY = '*',        // Wildcard - tất cả actions
  CREATE = 'create', // Tạo mới resource
  DELETE = 'delete', // Xóa resource
  EDIT = 'edit',     // Chỉnh sửa resource
  GET = 'get',       // Đọc/xem resource
}
```

## Resource Targets

Xác định phạm vi áp dụng của permission:

```typescript
enum PermissionResourceTarget {
  ANY = '*',    // Áp dụng cho tất cả resources cùng loại
  SOME = 'some' // Áp dụng cho một số resources cụ thể (được lọc theo role)
}
```

**Cách sử dụng:**

- `ANY` (`*`): Truy cập tất cả resources - thường dùng cho ADMIN/SUPER_ADMIN
- `SOME` (`some`): Truy cập một số resources - thường dùng cho STAFF/USER, danh sách cụ thể được xác định trong `permissionsContext`
- `<uuid>`: Truy cập resource cụ thể theo ID - dùng với dynamic resource ID functions

## Xử lý lỗi

Hệ thống throw các exception cụ thể với thông tin chi tiết:

### InsufficientPermissionsException

Khi user không có đủ quyền:

```json
{
  "statusCode": 403,
  "error": "INSUFFICIENT_PERMISSIONS",
  "message": "Insufficient permissions to edit users with id abc-123",
  "details": {
    "resourceType": "users",
    "action": "edit",
    "resourceTarget": "abc-123"
  }
}
```

### InvalidResourceIdException

Khi resource ID không hợp lệ:

```json
{
  "statusCode": 400,
  "error": "INVALID_RESOURCE_ID",
  "message": "Invalid resource id: Resource ID must be a valid UUID",
  "details": {
    "resourceId": "invalid-id",
    "reason": "Resource ID must be a valid UUID"
  }
}
```

### MissingPermissionDefinitionException

Khi route thiếu permission decorator:

```json
{
  "statusCode": 500,
  "error": "MISSING_PERMISSION_DEFINITION",
  "message": "Missing permission definition for GET /api/users",
  "details": {
    "method": "GET",
    "url": "/api/users"
  }
}
```

## Audit Logging

Tất cả quyết định phân quyền được ghi log tự động với thông tin:

- User ID, email, và role
- Action và resource đang truy cập
- Kết quả (GRANTED/DENIED)
- IP address và user agent
- Timestamp

### Log khi permission được cấp

```typescript
{
  userId: 'uuid',
  email: 'admin@example.com',
  role: 'admin',
  action: 'GET',
  resource: 'users',
  target: '*',
  result: 'granted',
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0...',
  timestamp: '2026-05-18T06:30:00.000Z'
}
```

### Log khi permission bị từ chối

```typescript
{
  userId: 'uuid',
  email: 'user@example.com',
  role: 'user',
  action: 'DELETE',
  resource: 'users',
  target: 'other-user-uuid',
  result: 'denied',
  reason: 'Insufficient permissions',
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0...',
  timestamp: '2026-05-18T06:30:00.000Z'
}
```

### Tích hợp với hệ thống audit bên ngoài

Logs được ghi vào application logger và có thể gửi đến hệ thống audit bên ngoài (Elasticsearch, CloudWatch, etc.) bằng cách implement `sendToAuditSystem()` trong [services/audit-log.service.ts](services/audit-log.service.ts).

## Caching

Permissions được cache trong memory trong 5 phút (có thể cấu hình qua biến môi trường `PERMISSIONS_CACHE_TTL`).

### Cache invalidation

- **Tự động**: Entries hết hạn được dọn dẹp mỗi phút
- **Thủ công**: Gọi `permissionsService.invalidateCache(userId)` khi permissions của user thay đổi
- **Toàn cục**: Gọi `permissionsService.invalidateAllCache()` khi quy tắc permissions thay đổi

### Khuyến nghị cho production

Thay thế in-memory cache bằng Redis để cache phân tán trên nhiều server instances:

```typescript
// Ví dụ implementation với Redis
@Injectable()
export class PermissionsCacheService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async get(userId: string): Promise<CachedPermission | null> {
    const cached = await this.redis.get(`permissions:${userId}`);
    return cached ? JSON.parse(cached) : null;
  }

  async set(userId: string, role: PermissionRole, permissions: Permission[]): Promise<void> {
    await this.redis.setex(
      `permissions:${userId}`,
      300, // 5 minutes TTL
      JSON.stringify({ role, permissions })
    );
  }

  async invalidate(userId: string): Promise<void> {
    await this.redis.del(`permissions:${userId}`);
  }

  async invalidateAll(): Promise<void> {
    const keys = await this.redis.keys('permissions:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

## Cấu hình

### Biến môi trường

```env
# Permission cache TTL tính bằng milliseconds (mặc định: 300000 = 5 phút)
PERMISSIONS_CACHE_TTL=300000
```

### Cấu hình trong code

```typescript
// permissions-cache.service.ts
const CACHE_TTL = parseInt(process.env.PERMISSIONS_CACHE_TTL || '300000', 10);
```

## Best Practices

### 1. Luôn sử dụng cả authentication và authorization guards

```typescript
// Đúng: Authentication trước, Authorization sau
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // Xác thực user
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard, // Kiểm tra quyền
    },
  ],
})
export class AppModule {}
```

### 2. Validate resource IDs

Hệ thống tự động validate UUIDs, nhưng bạn có thể thêm validation riêng:

```typescript
function GetValidatedResourceId(req: ExpressRequest): string {
  const { id } = req.params;

  if (!id) {
    throw new BadRequestException('Resource ID is required');
  }

  const resourceId = Array.isArray(id) ? id[0] : id;

  if (!isUuid(resourceId)) {
    throw new BadRequestException('Invalid resource ID format');
  }

  return resourceId;
}
```

### 3. Sử dụng permissions cụ thể, tránh wildcards

```typescript
// ❌ Tránh: Quá rộng
@RequiresPermission(
  PermissionResource.ANY,
  PermissionAction.ANY,
  PermissionResourceTarget.ANY
)

// Tốt: Cụ thể
@RequiresPermission(
  PermissionResource.USER,
  PermissionAction.GET,
  GetResourceIdFromParams
)
```

### 4. Monitor audit logs thường xuyên

Kiểm tra các lần bị từ chối quyền để phát hiện:
- Các cuộc tấn công tiềm ẩn
- Lỗi cấu hình permissions
- User cần được cấp thêm quyền

### 5. Luôn invalidate cache khi cần

```typescript
// Sau khi thay đổi role
async updateRole(userId: string, newRole: UserRole) {
  await this.usersRepository.update(userId, { role: newRole });
  this.permissionsService.invalidateCache(userId);
}

// Sau khi block/unblock user
async blockUser(userId: string) {
  await this.usersRepository.update(userId, { isBlocked: true });
  this.permissionsService.invalidateCache(userId);
}

// Sau khi xóa user
async deleteUser(userId: string) {
  await this.usersRepository.softDelete(userId);
  this.permissionsService.invalidateCache(userId);
}
```

### 6. Sử dụng @SkipPermissions đúng cách

```typescript
// Đúng: Public endpoints
@Post('login')
@SkipPermissions()
login() { }

@Get('health')
@SkipPermissions()
health() { }

// ❌ Sai: Sensitive endpoints
@Delete('users/:id')
@SkipPermissions()  // Nguy hiểm!
deleteUser() { }
```

### 7. Xử lý permissions context trong service

```typescript
@Injectable()
export class UsersService {
  async findAll(req: ExpressRequest) {
    const context = req.permissionsContext;

    // Luôn kiểm tra context
    if (!context) {
      throw new Error('Permissions context not found');
    }

    // Xử lý theo context
    if (context.allowedResourcesIds) {
      return this.findByIds(context.allowedResourcesIds);
    }

    if (context.deniedResourcesIds) {
      return this.findExcludingIds(context.deniedResourcesIds);
    }

    return this.findAll();
  }
}
```

## Troubleshooting

### Permission denied không rõ lý do

**Giải pháp:**
1. Kiểm tra audit logs để xem chi tiết
2. Verify user role trong database
3. Kiểm tra cache có đang lỗi thời không

```typescript
// Check logs
this.logger.warn(
  `Permission denied for user ${userId}: ${action} on ${resource}:${target}`
);

// Verify role
const user = await this.usersRepository.findOne({ where: { id: userId } });
console.log('User role:', user.role);

// Clear cache và thử lại
this.permissionsService.invalidateCache(userId);
```

### Cache không được invalidate

**Nguyên nhân:** Quên gọi `invalidateCache` sau khi thay đổi permissions

**Giải pháp:**
```typescript
// Luôn invalidate sau mọi thay đổi
async updateUserRole(userId: string, newRole: UserRole) {
  await this.usersRepository.update(userId, { role: newRole });
  this.permissionsService.invalidateCache(userId);
}
```

### Resource ID không hợp lệ

**Nguyên nhân:** ID không phải UUID hoặc format sai

**Giải pháp:**
```typescript
import { validate as isUuid } from 'uuid';

function GetResourceIdFromParams(req: ExpressRequest): string {
  const { id } = req.params;

  if (!id) {
    throw new BadRequestException('Resource ID is required');
  }

  const resourceId = Array.isArray(id) ? id[0] : id;

  if (!isUuid(resourceId)) {
    throw new BadRequestException('Invalid UUID format');
  }

  return resourceId;
}
```

### Guard không chạy

**Nguyên nhân:** Chưa apply guard globally hoặc thiếu decorator

**Giải pháp:**
```typescript
// 1. Apply guard globally
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})

// 2. Hoặc apply trên controller/route
@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController { }
```

### Missing permission definition error

**Nguyên nhân:** Route thiếu decorator `@RequiresPermission` hoặc `@SkipPermissions`

**Giải pháp:**
```typescript
// Thêm decorator vào route
@Get()
@RequiresPermission(
  PermissionResource.USER,
  PermissionAction.GET,
  PermissionResourceTarget.ANY
)
findAll() { }

// Hoặc skip nếu là public endpoint
@Get('public')
@SkipPermissions()
getPublic() { }
```

## TODO / Future Enhancements

- [ ] Replace in-memory cache with Redis for production
- [ ] Implement external audit system integration (Elasticsearch, CloudWatch)
- [ ] Add permission management UI (CRUD permissions via admin panel)
- [ ] Add database-driven permissions (store permissions in DB instead of code)
- [ ] Add permission inheritance and groups
- [ ] Add time-based permissions (temporary access)
- [ ] Add IP-based restrictions
- [ ] Add rate limiting per permission
- [ ] Add permission analytics dashboard

## Testing

### Unit test cho PermissionsGuard

```typescript
describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let permissionsService: PermissionsService;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: PermissionsService,
          useValue: {
            getMany: jest.fn(),
          },
        },
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            logPermissionGranted: jest.fn(),
            logPermissionDenied: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    permissionsService = module.get<PermissionsService>(PermissionsService);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should allow ADMIN to access any resource', async () => {
    const mockUser = { id: 'admin-id', role: UserRole.Admin };
    const mockContext = createMockExecutionContext(mockUser);

    jest.spyOn(permissionsService, 'getMany').mockResolvedValue({
      role: PermissionRole.ADMIN,
      permissions: [
        {
          resourceType: PermissionResource.ANY,
          action: PermissionAction.ANY,
          resourceTarget: PermissionResourceTarget.ANY,
          effect: PermissionEffect.ALLOW,
        },
      ],
    });

    jest.spyOn(reflector, 'get').mockReturnValue({
      resourceType: PermissionResource.USER,
      action: PermissionAction.GET,
      resourceTarget: PermissionResourceTarget.ANY,
      effect: PermissionEffect.ALLOW,
    });

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('should deny USER from accessing other users', async () => {
    const mockUser = { id: 'user-id', role: UserRole.User };
    const mockContext = createMockExecutionContext(mockUser);

    jest.spyOn(permissionsService, 'getMany').mockResolvedValue({
      role: PermissionRole.USER,
      permissions: [
        {
          resourceType: PermissionResource.USER,
          action: PermissionAction.GET,
          resourceTarget: 'user-id', // Chỉ có quyền trên chính mình
          effect: PermissionEffect.ALLOW,
        },
      ],
    });

    jest.spyOn(reflector, 'get').mockReturnValue({
      resourceType: PermissionResource.USER,
      action: PermissionAction.GET,
      resourceTarget: 'other-user-id', // Cố truy cập user khác
      effect: PermissionEffect.ALLOW,
    });

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      InsufficientPermissionsException
    );
  });

  it('should skip permission check when @SkipPermissions is used', async () => {
    const mockUser = { id: 'user-id', role: UserRole.User };
    const mockContext = createMockExecutionContext(mockUser);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });
});
```

### Integration test cho controller

```typescript
describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Get tokens
    adminToken = await getAuthToken(app, 'admin@example.com', 'password');
    userToken = await getAuthToken(app, 'user@example.com', 'password');
  });

  it('should allow ADMIN to get all users', () => {
    return request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('should deny USER from getting all users', () => {
    return request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('should allow USER to get their own profile', () => {
    return request(app.getHttpServer())
      .get('/users/user-id')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });

  it('should deny USER from deleting other users', () => {
    return request(app.getHttpServer())
      .delete('/users/other-user-id')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });
});
```

## Support

For issues or questions, contact the backend team or create an issue in the project repository.
