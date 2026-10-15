import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../../common/decorators/index.js';
import { SearchAnalyticsService } from './search-analytics.service.js';
import { AnalyticsInteractionDto } from './search-analytics.dto.js';

@ApiTags('Search Analytics')
@Controller('analytics')
@SkipPermissions()
export class SearchAnalyticsController {
  constructor(private readonly service: SearchAnalyticsService) {}
  @Post('interactions') @Public()
  @ApiOperation({ summary: 'Ghi nhận nhấn kết quả/xem gói khám, chống ghi trùng bằng event ID' })
  record(@Body() dto: AnalyticsInteractionDto, @Req() req: { user?: { id: string } }) {
    return this.service.recordInteraction(dto, req.user?.id);
  }
}
