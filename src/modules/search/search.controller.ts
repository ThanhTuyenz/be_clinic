import { Controller, Get, Query, Req, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtPayloadType } from '../auth/auth-local/types/index.js';
import { SearchQueryDto } from './dtos/search-query.dto.js';
import { SearchService } from './services/search.service.js';

type SearchRequest = Request & { user?: JwtPayloadType };

@ApiTags('Search')
@Controller('search')
@SetMetadata('requestTimeoutMs', 60000)
export class SearchController {
  constructor(private readonly search: SearchService) {}
  @Get()
  @Public()
  @ApiOperation({ summary: 'Tìm gói khám, bác sĩ và cơ sở; xếp hạng gói khám bằng RRF' })
  find(@Query() query: SearchQueryDto, @Req() req: SearchRequest) {
    return this.search.find(query.q, query.branchId, {
      sessionId: query.sessionId, accountId: req.user?.id, searchRequestId: query.searchRequestId,
    });
  }
}

/** Keep old clients working; the implementation belongs to SearchModule. */
@ApiTags('Search')
@Controller('recommendations')
@SetMetadata('requestTimeoutMs', 60000)
export class LegacySearchController {
  constructor(private readonly search: SearchService) {}
  @Get('semantic-search')
  @Public()
  @ApiOperation({ summary: 'Đường dẫn tương thích; dùng GET /search cho client mới', deprecated: true })
  find(@Query() query: SearchQueryDto, @Req() req: SearchRequest) {
    return this.search.find(query.q, query.branchId, {
      sessionId: query.sessionId, accountId: req.user?.id, searchRequestId: query.searchRequestId,
    });
  }
}
