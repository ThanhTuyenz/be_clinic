import { Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  completeRegister as legacyCompleteRegister,
  login as legacyLogin,
  me as legacyMe,
  register as legacyRegister,
  resendOtp as legacyResendOtp,
  startRegister as legacyStartRegister,
  staffLogin as legacyStaffLogin,
  updateMe as legacyUpdateMe,
  verifyEmail as legacyVerifyEmail,
} from '../../src/controllers/authController.js'
import { JwtAuthGuard } from '../common/jwt-auth.guard.js'

@Controller('auth')
export class AuthController {
  @Post('register')
  register(@Req() req: Request, @Res() res: Response) {
    return legacyRegister(req, res)
  }

  @Post('start-register')
  startRegister(@Req() req: Request, @Res() res: Response) {
    return legacyStartRegister(req, res)
  }

  @Post('verify-email')
  verifyEmail(@Req() req: Request, @Res() res: Response) {
    return legacyVerifyEmail(req, res)
  }

  @Post('complete-register')
  completeRegister(@Req() req: Request, @Res() res: Response) {
    return legacyCompleteRegister(req, res)
  }

  @Post('resend-otp')
  resendOtp(@Req() req: Request, @Res() res: Response) {
    return legacyResendOtp(req, res)
  }

  @Post('login')
  login(@Req() req: Request, @Res() res: Response) {
    return legacyLogin(req, res)
  }

  @Post('staff-login')
  staffLogin(@Req() req: Request, @Res() res: Response) {
    return legacyStaffLogin(req, res)
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request, @Res() res: Response) {
    return legacyMe(req, res)
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(@Req() req: Request, @Res() res: Response) {
    return legacyUpdateMe(req, res)
  }
}