import { Body, Controller, ForbiddenException, Get, Logger, Param, Post, Query, Req, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayloadType } from '../auth/auth-local/types/index.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { RecommendationService } from './recommendation.service.js';
import {
  HomeRecommendationQueryDto,
  HomeRecommendationResponseDto,
  ProfileRecommendationResponseDto,
  SemanticSearchQueryDto,
  TrackBehaviorDto,
} from './recommendation.dto.js';

type RecommendationRequest = Request & { user?: JwtPayloadType };

@ApiTags('Recommendations')
@Controller('recommendations')
@SetMetadata('requestTimeoutMs', 60000)
export class RecommendationController {
  private readonly logger = new Logger(RecommendationController.name);

  constructor(private readonly recommendationService: RecommendationService) {}

  @Get('home')
  @Public()
  @ApiOperation({ summary: 'Lấy danh sách gói khám đề xuất tổng hợp Trang Chủ (Hybrid: Hồ sơ AI + Hành vi lướt web)' })
  async getHomeRecommendations(
    @Query() query: HomeRecommendationQueryDto,
    @Req() req: RecommendationRequest,
  ): Promise<HomeRecommendationResponseDto> {
    const userId = req?.user?.id;
    if (query.profileId && !userId) {
      throw new ForbiddenException('Cần đăng nhập để nhận gợi ý theo hồ sơ bệnh nhân.');
    }
    this.logger.log(
      `[API GET] /home (profileId: ${query.profileId || 'none'}, sessionId: ${query.sessionId || 'none'}, userId: ${userId || 'guest'})`,
    );
    return this.recommendationService.getHomeRecommendations(query, userId, req?.user?.role);
  }

  @Post('track')
  @Public()
  @ApiOperation({ summary: 'Ghi nhận telemetry hành vi người dùng (Tìm kiếm, Xem gói, Bỏ dở) vào Redis' })
  async trackBehavior(@Body() dto: TrackBehaviorDto, @Req() req: RecommendationRequest) {
    const userId = req?.user?.id;
    return this.recommendationService.trackUserBehavior(dto, userId);
  }



  @Get('semantic-search')
  @Public()
  @ApiOperation({ summary: 'Tìm kiếm gói khám bằng ngôn ngữ tự nhiên / triệu chứng y khoa' })
  async semanticSearch(
    @Query() query: SemanticSearchQueryDto,
  ) {
    this.logger.log(`[API GET] /semantic-search?q="${query.q}"${query.branchId ? ` (branchId: ${query.branchId})` : ''}`);
    return this.recommendationService.semanticSearchPackages(query.q, query.branchId);
  }

  @Post('patient-profile/:profileId/refresh')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Chủ động phân tích lại gợi ý bằng AI và cập nhật vào Cache' })
  async refreshProfileRecommendations(
    @Param('profileId') profileId: string,
    @Req() req: RecommendationRequest,
  ): Promise<ProfileRecommendationResponseDto> {
    this.logger.log(`[API POST] /patient-profile/${profileId}/refresh (Forcing AI re-analysis)...`);
    return this.recommendationService.analyzeAndCacheRecommendations(profileId, req?.user?.id, req?.user?.role);
  }

  @Get('suggest-symptoms')
  @Public()
  @ApiOperation({ summary: 'AI phân tích và gợi ý triệu chứng liên quan cho gói khám' })
  async suggestSymptoms(
    @Query('name') name: string,
    @Query('specialty') specialty?: string,
  ) {
    this.logger.log(`[API GET] /suggest-symptoms?name="${name}"`);
    return this.recommendationService.suggestSymptomsForPackage(name, specialty);
  }
}
