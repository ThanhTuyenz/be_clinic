import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js';
import { CreatePatientProfileDto, UpdatePatientProfileDto } from './patient-profiles.dto.js';
import { PatientProfilesService } from './patient-profiles.service.js';

@ApiTags('Patient profiles')
@ApiBearerAuth('access-token')
@Controller('patient-profiles')
@SkipPermissions()
export class PatientProfilesController {
  constructor(private readonly service: PatientProfilesService) {}
  @Get() @ApiOperation({ summary: 'Danh sách hồ sơ chính/người thân của tài khoản' })
  list(@Req() request: Request) { return this.service.list(request.user!.id); }
  @Post() @ApiOperation({ summary: 'Tạo hồ sơ bệnh nhân hoặc người thân' })
  create(@Req() request: Request, @Body() dto: CreatePatientProfileDto) { return this.service.create(request.user!.id, dto); }
  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật thông tin hồ sơ bệnh nhân' })
  update(@Req() request: Request, @Param('id') id: string, @Body() dto: UpdatePatientProfileDto) {
    const user = request.user!;
    const isStaff = ['ADMIN', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(user.role);
    return this.service.update(user.id, id, dto, isStaff);
  }
}
