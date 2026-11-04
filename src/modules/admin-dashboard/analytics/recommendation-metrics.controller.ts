import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, SkipPermissions } from '../../../common/decorators/index.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { RecommendationMetricsService } from './recommendation-metrics.service.js';
import { RecommendationMetricsQueryDto } from './recommendation-metrics.dto.js';

@ApiTags('Search Analytics')
@Controller('analytics')
@SkipPermissions()
export class RecommendationMetricsController {
  constructor(private readonly service: RecommendationMetricsService) {}
  @Get('recommendations')
  @Roles('CHAIN_MANAGER', 'SUPER_ADMIN')
  @UseGuards(RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Hiệu quả gợi ý theo nhóm lượt hiển thị: CTR, tạo giữ chỗ, đặt thành công và thanh toán' })
  recommendationMetrics(@Query() query: RecommendationMetricsQueryDto) {
    return this.service.recommendationMetrics(query);
  }
}
