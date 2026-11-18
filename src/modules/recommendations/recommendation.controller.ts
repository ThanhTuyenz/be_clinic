import { Body, Controller, Get, Logger, Param, Post, Query, Req, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayloadType } from '../auth/auth-local/types/index.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { RecommendationService } from './recommendation.service.js';
import {
  ProfileRecommendationResponseDto,
  TrackBehaviorDto,
  RecommendationSessionQueryDto,
  RecommendationSectionDto,
  ProfileRecommendationSectionDto,
} from './recommendation.dto.js';

type RecommendationRequest = Request & { user?: JwtPayloadType };

@ApiTags('Recommendations')
@Controller('recommendations')
@SetMetadata('requestTimeoutMs', 60000)
export class RecommendationController {
  private readonly logger = new Logger(RecommendationController.name);

  constructor(
    private readonly recommendationService: RecommendationService,
  ) { }

  @Post('track')
  @Public()
  @ApiOperation({ summary: 'Ghi nhận lượt xem gói khám; tìm kiếm và bỏ dở được xác định tại backend' })
  async trackBehavior(@Body() dto: TrackBehaviorDto, @Req() req: RecommendationRequest) {
    const userId = req?.user?.id;
    return this.recommendationService.trackUserBehavior(dto, userId);
  }

  @Get('behavior')
  @Public()
  @ApiOperation({ summary: 'Gợi ý theo tìm kiếm, lượt xem và đặt khám chưa hoàn tất của tài khoản hoặc phiên khách' })
  getBehaviorRecommendations(
    @Query() query: RecommendationSessionQueryDto,
    @Req() req: RecommendationRequest,
  ): Promise<RecommendationSectionDto> {
    return this.recommendationService.getBehaviorRecommendations(query.sessionId, req.user?.id);
  }

  @Get('patient-profile/:profileId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Gợi ý riêng theo hồ sơ sức khỏe, kiểm tra quyền sở hữu trước khi đọc cache' })
  getProfileRecommendations(
    @Param('profileId') profileId: string,
    @Query() query: RecommendationSessionQueryDto,
    @Req() req: RecommendationRequest,
  ): Promise<ProfileRecommendationSectionDto> {
    return this.recommendationService.getProfileRecommendations(profileId, query.sessionId, req.user?.id, req.user?.role);
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
