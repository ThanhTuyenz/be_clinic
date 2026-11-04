import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { BranchesService } from './branches.service.js';

@Public()
@ApiTags('Branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách cơ sở đang hoạt động' })
  branches() {
    return this.branchesService.branches();
  }

  @Get(':branchId/departments')
  @ApiOperation({ summary: 'Chuyên khoa có bác sĩ tại cơ sở' })
  departments(@Param('branchId') branchId: string) {
    return this.branchesService.departments(branchId);
  }
}
