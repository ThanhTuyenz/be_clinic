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
  @ApiOperation({ summary: 'Gửi yêu cầu liên hệ' })
  async submit(@Body() body: ContactBody) {
    const now = new Date()
    const result = await mongoose.connection.db.collection('contacts').insertOne({
      fullName: String(body.fullName || '').trim(),
      email: String(body.email || '').trim().toLowerCase(),
      phone: String(body.phone || '').trim(),
      subject: String(body.subject || '').trim(),
      message: String(body.message || '').trim(),
      adminReply: '',
      replyAt: null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    return { id: String(result.insertedId), message: 'Đã gửi yêu cầu liên hệ.' }
  }

  @Get('my-notifications')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Danh sách phản hồi liên hệ của người dùng' })
  async myNotifications(@Req() request: Request & { user?: { email?: string } }) {
    const email = String(request.user?.email || '').trim().toLowerCase()
    const rows = email
      ? await mongoose.connection.db.collection('contacts').find({ email, adminReply: { $ne: '' } }).sort({ replyAt: -1, createdAt: -1 }).limit(50).toArray()
      : []
    return {
      total: rows.length,
      items: rows.map((row) => ({ ...row, id: String(row._id), _id: undefined })),
    }
  }
}
