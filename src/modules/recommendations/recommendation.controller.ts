import { Body, Controller, Get, Logger, Param, Post, Query, Req, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipPermissions } from 'src/common/decorators';
import { RecommendationService } from './recommendation.service.js';
import {
  HomeRecommendationQueryDto,
  HomeRecommendationResponseDto,
  ProfileRecommendationResponseDto,
  TrackBehaviorDto,
} from './recommendation.dto.js';

@ApiTags('Recommendations')
@Controller('recommendations')
@Public()
@SkipPermissions()
@SetMetadata('requestTimeoutMs', 60000)
export class RecommendationController {
  private readonly logger = new Logger(RecommendationController.name);

  constructor(private readonly recommendationService: RecommendationService) {}

  @Get('home')
  @ApiOperation({ summary: 'Lấy danh sách gói khám đề xuất tổng hợp Trang Chủ (Hybrid: Hồ sơ AI + Hành vi lướt web)' })
  async getHomeRecommendations(
    @Query() query: HomeRecommendationQueryDto,
    @Req() req: any,
  ): Promise<HomeRecommendationResponseDto> {
    const userId = req?.user?.id || req?.user?.sub;
    this.logger.log(
      `[API GET] /home (profileId: ${query.profileId || 'none'}, sessionId: ${query.sessionId || 'none'}, branchId: ${query.branchId || 'all'}, userId: ${userId || 'guest'})`,
    );
    return this.recommendationService.getHomeRecommendations(query, userId);
  }

  @Post('track')
  @ApiOperation({ summary: 'Ghi nhận telemetry hành vi người dùng (Tìm kiếm, Xem gói, Bỏ dở) vào Redis' })
  async trackBehavior(@Body() dto: TrackBehaviorDto, @Req() req: any) {
    const userId = req?.user?.id || req?.user?.sub;
    return this.recommendationService.trackUserBehavior(dto, userId);
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
