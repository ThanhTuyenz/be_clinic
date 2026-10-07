import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Services } from '../../../../common/utils/constants.js';
import { IUsersService } from '../../users/users.js';
import { ISessionService } from '../../session/session.js';
import { User, UserStatus } from '../../users/entities/user.entity.js';
import { LoginResponseType } from '../types/login-response.type.js';
import { AuthProvidersEnum } from '../enums/auth-providers.enum.js';
import { normalizePhoneVariants } from '../../../../common/utils/phone.util.js';
import { AuthOtpService } from './auth-otp.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { ZaloZnsService } from '../../../../infrastructure/zalo-zns/zalo-zns.service.js';
import { HistoryService } from '../../history/history.service.js';
import { HISTORY_ACTIONS } from '../../history/history.js';

/**
 * AccountLinkingService — Đơn trách nhiệm: Luồng liên kết tài khoản Zalo ↔ Email.
 *
 * Bao gồm: checkPhoneLink, requestLinkOtp, confirmLinkAccount.
 * Tách khỏi AuthService để isolate "Zalo linking flow" hoàn toàn.
 */
@Injectable()
export class AccountLinkingService {
  private readonly logger = new Logger(AccountLinkingService.name);

  constructor(
    @Inject(Services.USERS) private readonly usersService: IUsersService,
    @Inject(Services.SESSION) private readonly sessionService: ISessionService,
    private readonly authOtpService: AuthOtpService,
    private readonly authTokenService: AuthTokenService,
    private readonly zaloZnsService: ZaloZnsService,
    private readonly historyService: HistoryService,
  ) {}

  /**
   * Kiểm tra SĐT có thuộc tài khoản Zalo để gợi ý liên kết email không.
   */
  async checkPhoneLink(phoneNumber: string): Promise<{
    exists: boolean;
    isZaloAccount: boolean;
    fullName?: string | null;
    email?: string | null;
  }> {
    const rawPhone = (phoneNumber || '').trim();
    if (!rawPhone) return { exists: false, isZaloAccount: false };

    const user = await this.usersService.findByPhoneVariants(normalizePhoneVariants(rawPhone));
    if (!user) return { exists: false, isZaloAccount: false };

    const isZalo = Boolean(
      user.zaloId ||
      user.provider === AuthProvidersEnum.zalo ||
      (user.provider as string) === 'zalo',
    );

    let maskedEmail: string | null = null;
    if (user.email && !user.email.endsWith('@phone.vitacare.vn')) {
      const [name, domain] = user.email.split('@');
      maskedEmail = domain ? `${name.slice(0, 2)}***@${domain}` : user.email;
    }

    return { exists: true, isZaloAccount: isZalo, fullName: user.fullName, email: maskedEmail };
  }

  /**
   * Gửi OTP xác thực liên kết tài khoản qua Zalo ZNS.
   */
  async requestLinkOtp(phoneNumber: string): Promise<{ message: string; expiresIn: number }> {
    const rawPhone = (phoneNumber || '').trim();
    if (!rawPhone) throw new BadRequestException('Số điện thoại không hợp lệ');

    const user = await this.usersService.findByPhoneVariants(normalizePhoneVariants(rawPhone));
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản với số điện thoại này');

    // Kiểm tra cooldown — chặn spam OTP
    await this.authOtpService.checkCooldown('link', rawPhone);

    const otp = this.authOtpService.generateOtp();
    await this.authOtpService.storeOtp('link', rawPhone, otp);

    await this.zaloZnsService.sendOtp({
      to: user.phoneNumber || rawPhone,
      otp,
      expiresInMinutes: 10,
      purpose: 'LINK_ACCOUNT',
    });

    return { message: 'Mã OTP xác thực liên kết tài khoản đã được gửi đến Zalo của bạn', expiresIn: 600 };
  }

  /**
   * Xác thực OTP và liên kết email/mật khẩu vào tài khoản Zalo.
   * Trả về LoginResponseType để FE đăng nhập ngay sau khi liên kết.
   */
  async confirmLinkAccount(dto: {
    phoneNumber: string;
    email: string;
    password?: string;
    fullName?: string;
    otp: string;
  }): Promise<LoginResponseType> {
    const rawPhone = (dto.phoneNumber || '').trim();
    const targetEmail = (dto.email || '').trim().toLowerCase();

    const user = await this.usersService.findByPhoneVariants(normalizePhoneVariants(rawPhone));
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản với số điện thoại này');

    // Xác thực OTP (throws nếu sai/hết hạn/bị khóa)
    await this.authOtpService.verifyOtp('link', rawPhone, dto.otp);

    // Kiểm tra email không bị dùng bởi tài khoản khác
    const existingEmailUser = await this.usersService.findOneUser({ email: targetEmail });
    if (existingEmailUser && existingEmailUser.id !== user.id) {
      throw new ConflictException('Email này đã được sử dụng bởi một tài khoản khác');
    }

    // Cập nhật thông tin tài khoản
    user.email = targetEmail;
    if (dto.password) user.password = dto.password;
    if (dto.fullName && (!user.fullName || user.fullName.startsWith('User_'))) {
      user.fullName = dto.fullName;
    }
    user.status = UserStatus.Active;
    await this.usersService.saveUser(user);

    // Xóa OTP đã dùng
    await this.authOtpService.deleteOtp('link', rawPhone);

    // Cấp session và JWT
    const session = await this.sessionService.create({ user });
    user.lastLoginAt = new Date();
    await this.usersService.saveUser(user);

    const { token, refreshToken, tokenExpires } = await this.authTokenService.getTokensData({
      id: user.id,
      sessionId: session.id,
    });

    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_LOGIN_SUCCESS,
      message: `Người dùng liên kết thành công Email ${targetEmail} với tài khoản Zalo ${rawPhone}`,
      actorId: user.id,
      actorEmail: targetEmail,
      targetType: 'user',
      targetId: user.id,
    });

    return { refreshToken, token, tokenExpires, user };
  }
}
