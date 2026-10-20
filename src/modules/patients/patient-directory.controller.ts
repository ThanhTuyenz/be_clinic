import { Controller, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppPermission } from '../../common/constants/permissions.constant.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator.js';
import { PatientDirectoryService } from './patient-directory.service.js';

@ApiTags('PatientDirectory')
@ApiBearerAuth('access-token')
@Controller('patients')
@SkipPermissions()
export class PatientDirectoryController {
  constructor(private readonly patients: PatientDirectoryService) {}

  @Get('lookup')
  @ApiOperation({ summary: 'Tra cứu bệnh nhân bằng mã bệnh nhân' })
  @ApiQuery({ name: 'code' })
  lookupPatientByCode(@Req() req: Request) {
    return this.patients.patientByCode(req.user!.id, String(req.query.code || ''));
  }

  @Get()
  @RequirePermissions(AppPermission.PATIENT_READ)
  @ApiOperation({ summary: 'Danh sách bệnh nhân cho bộ phận tiếp nhận' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false, description: 'Từ khóa tìm kiếm nhanh (mã BN, CCCD, họ tên, SĐT, email)' })
  @ApiQuery({ name: 'patientCode', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'phone', required: false })
  listPatientsReception(@Req() req: Request) {
    return this.patients.patients(req.user!.id, req.query as Record<string, string | undefined>);
  }
}
