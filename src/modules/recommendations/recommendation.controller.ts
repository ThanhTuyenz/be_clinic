import { Controller, Get, Logger, Param, Post, Query, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from '../auth/permissions/decorators/skip-permissions.decorator.js';
import { RecommendationService } from './recommendation.service.js';
import { ProfileRecommendationResponseDto } from './recommendation.dto.js';

@ApiTags('Recommendations')
@Controller('recommendations')
@Public()
@SkipPermissions()
@SetMetadata('requestTimeoutMs', 60000)
export class RecommendationController {
  private readonly logger = new Logger(RecommendationController.name);

  constructor(private readonly recommendationService: RecommendationService) {}

  @Get('patient-profile/:profileId')
  @ApiOperation({ summary: 'Lấy danh sách gói khám đề xuất cá nhân hóa cho hồ sơ bệnh nhân (Cache Redis 0ms)' })
  async getProfileRecommendations(
    @Param('profileId') profileId: string,
    @Query('branchId') branchId?: string,
  ): Promise<ProfileRecommendationResponseDto> {
    this.logger.log(`[API GET] /patient-profile/${profileId}${branchId ? ` (branchId: ${branchId})` : ''}`);
    return this.recommendationService.getRecommendations(profileId, branchId);
  }

  @Get('semantic-search')
  @ApiOperation({ summary: 'Tìm kiếm gói khám bằng ngôn ngữ tự nhiên / triệu chứng y khoa' })
  async semanticSearch(
    @Query('q') query: string,
    @Query('branchId') branchId?: string,
  ) {
    this.logger.log(`[API GET] /semantic-search?q="${query}"${branchId ? ` (branchId: ${branchId})` : ''}`);
    return this.recommendationService.semanticSearchPackages(query, branchId);
  }

  @Post('patient-profile/:profileId/refresh')
  @ApiOperation({ summary: 'Chủ động phân tích lại gợi ý bằng AI và cập nhật vào Cache' })
  async refreshProfileRecommendations(
    @Param('profileId') profileId: string,
    @Query('branchId') branchId?: string,
  ): Promise<ProfileRecommendationResponseDto> {
    this.logger.log(`[API POST] /patient-profile/${profileId}/refresh (Forcing AI re-analysis)...`);
    return this.recommendationService.analyzeAndCacheRecommendations(profileId, branchId);
  }

  @Get('suggest-symptoms')
  @ApiOperation({ summary: 'AI phân tích và gợi ý triệu chứng liên quan cho gói khám' })
  async suggestSymptoms(
    @Query('name') name: string,
    @Query('specialty') specialty?: string,
  ) {
    this.logger.log(`[API GET] /suggest-symptoms?name="${name}"`);
    return this.recommendationService.suggestSymptomsForPackage(name, specialty);
  }
}

