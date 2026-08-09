import { Controller, Get } from '@nestjs/common'
import { Public } from '../common/decorators/public.decorator.js'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

@Public()
@ApiTags('System')
@Controller()
export class AppController {
  @Get('health')
  @ApiOperation({ summary: 'Kiểm tra trạng thái backend' })
  health() {
    return { ok: true, service: 'be_clinic' }
  }
}
