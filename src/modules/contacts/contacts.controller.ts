import { Body, Controller, Get, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import mongoose from 'mongoose'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipPermissions } from '../permissions/decorators/skip-permissions.decorator.js'

type ContactBody = {
  fullName?: string
  email?: string
  phone?: string
  subject?: string
  message?: string
}

@ApiTags('Contacts')
@Controller('contacts')
@SkipPermissions()
export class ContactsController {
  @Post()
  @Public()
  @ApiOperation({ summary: 'Gửi yêu cầu liên hệ (Tạm thời bảo trì)' })
  async submit() {
    return { id: '', message: 'Tính năng liên hệ tạm thời ngưng hoạt động.' }
  }

  @Get('my-notifications')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Danh sách phản hồi liên hệ (Tạm thời bảo trì)' })
  async myNotifications() {
    return {
      total: 0,
      items: [],
    }
  }
}


