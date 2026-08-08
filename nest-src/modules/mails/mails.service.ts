import { Injectable } from '@nestjs/common'
import type { IMailsService } from './mails.js'

@Injectable()
export class MailsService implements IMailsService {
  confirmRegisterUser() {
    return Promise.resolve(undefined)
  }

  forgotPassword() {
    return Promise.resolve(undefined)
  }

  resetPassword() {
    return Promise.resolve(undefined)
  }
}