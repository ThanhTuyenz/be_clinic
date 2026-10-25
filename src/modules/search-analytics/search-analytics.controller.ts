import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles, SkipPermissions } from '../../common/decorators/index.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SearchAnalyticsService } from './search-analytics.service.js';
import { AnalyticsInteractionDto, RecommendationMetricsQueryDto } from './search-analytics.dto.js';

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

  @Get('recommendations')
  @Roles('CHAIN_MANAGER', 'SUPER_ADMIN')
  @UseGuards(RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Hiệu quả gợi ý theo nhóm lượt hiển thị: CTR, tạo giữ chỗ, đặt thành công và thanh toán' })
  recommendationMetrics(@Query() query: RecommendationMetricsQueryDto) {
    return this.service.recommendationMetrics(query);
  }
}
