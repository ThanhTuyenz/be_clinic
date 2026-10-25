import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppPermission } from '../../common/constants/permissions.constant.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import {
CreatePatientProfileDto,
PatientProfileResponseDto,
UpdatePatientProfileDto,
} from './patient-profiles.dto.js';
import { PatientProfilesService } from './patient-profiles.service.js';

@ApiTags('Patient profiles')
@ApiBearerAuth('access-token')
@Controller('patient-profiles')
export class PatientProfilesController {
  constructor(private readonly service: PatientProfilesService) { }

  @Get()
  @RequirePermissions(AppPermission.PATIENT_READ)
  @ApiOperation({ summary: 'Danh sách hồ sơ chính/người thân của tài khoản' })
  @ApiResponse({ status: 200, type: [PatientProfileResponseDto] })
  list(@Req() request: Request): Promise<PatientProfileResponseDto[]> {
    return this.service.list(request.user!.id);
  }

  @Post()
  @RequirePermissions(AppPermission.PATIENT_CREATE)
  @ApiOperation({ summary: 'Tạo hồ sơ bệnh nhân hoặc người thân' })
  @ApiResponse({ status: 201, type: PatientProfileResponseDto })
  create(@Req() request: Request, @Body() dto: CreatePatientProfileDto): Promise<PatientProfileResponseDto> {
    return this.service.create(request.user!.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(AppPermission.PATIENT_UPDATE)
  @ApiOperation({ summary: 'Cập nhật thông tin hồ sơ bệnh nhân' })
  @ApiResponse({ status: 200, type: PatientProfileResponseDto })
  update(@Req() request: Request, @Param('id') id: string, @Body() dto: UpdatePatientProfileDto): Promise<PatientProfileResponseDto> {
    const user = request.user!;
    const isStaff = ['CHAIN_MANAGER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(user.role);
    return this.service.update(user.id, id, dto, isStaff);
  }

  @Get(':id/medical-records')
  @RequirePermissions(AppPermission.CLINICAL_READ)
  @ApiOperation({ summary: 'Lấy thông tin bệnh án và lịch sử các ca khám của hồ sơ bệnh nhân' })
  getMedicalRecord(@Req() request: Request, @Param('id') patientProfileId: string) {
    return this.service.getMedicalRecord(request.user!.id, patientProfileId);
  }
}
