import { Controller, Get, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js'
import { AppPermission } from '../../common/constants/permissions.constant.js'
import { IntegrationsService } from './integrations.service.js'

@ApiTags('Integration settings')
@ApiBearerAuth('access-token')
@Controller('admin/integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}
  @Get()
  @RequirePermissions(AppPermission.INTEGRATION_READ)
  @ApiOperation({ summary: 'Trạng thái cấu hình tích hợp dành cho Admin; không trả thông tin bí mật' })
  overview(@Req() req: Request) { return this.service.overview(String(req.user!.role)) }
  @Post('smtp/verify')
  @RequirePermissions(AppPermission.INTEGRATION_VERIFY)
  @ApiOperation({ summary: 'Kiểm tra kết nối SMTP, không gửi email' })
  verifySmtp(@Req() req: Request) { return this.service.verifySmtp(String(req.user!.role), req.user!.id) }
}
