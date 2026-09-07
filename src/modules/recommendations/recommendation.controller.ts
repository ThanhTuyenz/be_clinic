import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { RecommendationService } from './recommendation.service.js';
import { ProfileRecommendationResponseDto } from './recommendation.dto.js';

@ApiTags('Recommendations')
@Controller('recommendations')
@SkipPermissions()
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get('patient-profile/:profileId')
  @ApiOperation({ summary: 'Lấy danh sách gói khám đề xuất cá nhân hóa cho hồ sơ bệnh nhân (Cache Redis 0ms)' })
  async getProfileRecommendations(
    @Param('profileId') profileId: string,
    @Query('branchId') branchId?: string,
  ): Promise<ProfileRecommendationResponseDto> {
    return this.recommendationService.getRecommendations(profileId, branchId);
  }

  @Post('patient-profile/:profileId/refresh')
  @ApiOperation({ summary: 'Chủ động phân tích lại gợi ý bằng AI và cập nhật vào Cache' })
  async refreshProfileRecommendations(
    @Param('profileId') profileId: string,
    @Query('branchId') branchId?: string,
  ): Promise<ProfileRecommendationResponseDto> {
    return this.recommendationService.analyzeAndCacheRecommendations(profileId, branchId);
  }
}
