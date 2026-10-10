import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { IUsersService } from '../users/users.js';
import { Services } from '../../../common/utils/constants.js';
import { AuthEmailLoginDto, AuthRegisterDto } from './dtos/index.js';
import { AuthProvidersEnum } from './enums/auth-providers.enum.js';
import { createHash } from 'crypto';
import { User, UserRole, UserStatus } from '../users/entities/user.entity.js';
import { ISessionService } from '../session/session.js';
import { IAuthService } from './auth.js';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { compareHash } from '../../../common/utils/helpers.js';
import { IMailsService } from '../../../infrastructure/mail/mails.js';
import {
  LoginResponseType,
  JwtPayloadType,
  JwtRefreshPayloadType,
} from './types/index.js';
import { NullableType } from '../../../common/utils/types/nullable.type.js';
import { SocialType } from '../../../common/utils/social.type.js';
import { HistoryService } from '../history/history.service.js';
import { HISTORY_ACTIONS } from '../history/history.js';
import { TokenBlacklistService } from '../jwt-auth-core/token-blacklist.service.js';
import { normalizePhoneVariants } from '../../../common/utils/phone.util.js';

// Sub-services
import { AuthOtpService } from './services/auth-otp.service.js';
import { AuthTokenService } from './services/auth-token.service.js';
import { PasswordResetService } from './services/password-reset.service.js';

@Injectable()
export class AuthService implements IAuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(Services.USERS) private readonly usersService: IUsersService,
    @Inject(Services.MAILS) private readonly mailsService: IMailsService,
    @Inject(Services.SESSION) private readonly sessionService: ISessionService,
    private readonly passwordResetService: PasswordResetService,
    private readonly historyService: HistoryService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    // Sub-services
    private readonly authOtpService: AuthOtpService,
    private readonly authTokenService: AuthTokenService,
  ) {}

  // ─── Email / Password ─────────────────────────────────────────────────────

  async checkEmail(email: string): Promise<boolean> {
    const user = await this.usersService.findByEmail(email);
    return !user || user.status !== UserStatus.Active;
  }

  async validateLogin(loginDto: AuthEmailLoginDto): Promise<LoginResponseType> {
    const rawInput = (loginDto.email || '').trim();
    const isEmail = rawInput.includes('@');

    let user: User | null = null;
    if (isEmail) {
      user = await this.usersService.findOneUser({ email: rawInput.toLowerCase() });
    } else {
      user = await this.usersService.findByPhoneVariants(normalizePhoneVariants(rawInput));
    }

    if (!user) {
      throw new HttpException(
        { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { email: 'notFound' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const authProvider = user.provider ?? AuthProvidersEnum.email;
    if (authProvider !== AuthProvidersEnum.email) {
      throw new HttpException(
        { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { email: `needLoginViaProvider:${authProvider}` } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (user.status !== UserStatus.Active) {
      throw new HttpException(
        { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { email: 'inactive' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (user.isDeleted) throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
    if (user.isBlocked) throw new UnauthorizedException('Tài khoản đã bị khóa');

    const isValidPassword = await compareHash(loginDto.password, user.password);
    if (!isValidPassword) {
      throw new HttpException(
        { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { password: 'incorrectPassword' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    user.lastLoginAt = new Date();
    await this.usersService.saveUser(user);

    const session = await this.sessionService.create({ user });
    const { token, refreshToken, tokenExpires } = await this.authTokenService.getTokensData({
      id: user.id,
      sessionId: session.id,
    });

    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_LOGIN_SUCCESS,
      message: 'Người dùng đăng nhập thành công',
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });

    return { refreshToken, token, tokenExpires, user };
  }

  // ─── Social Login ─────────────────────────────────────────────────────────

  async validateSocialLogin(
    authProvider: AuthProvidersEnum,
    socialData: SocialType,
  ): Promise<LoginResponseType> {
    let user: NullableType<User> = null;
    const socialEmail = socialData.email?.toLowerCase().trim();

    // 1. Tìm theo zaloId hoặc provider + socialId
    if (authProvider === AuthProvidersEnum.zalo) {
      user = await this.usersService.findOneUser({ zaloId: socialData.id } as any);
    }
    if (!user) {
      user = await this.usersService.findOneUser({ socialId: socialData.id, provider: authProvider });
    }

    // 2. Auto-link theo SĐT
    if (!user && socialData.phoneNumber) {
      const rawPhone = socialData.phoneNumber.trim();
      user = await this.usersService.findByPhoneVariants(normalizePhoneVariants(rawPhone));
      if (user) {
        if (authProvider === AuthProvidersEnum.zalo) {
          user.zaloId = socialData.id;
        } else {
          user.socialId = socialData.id;
        }
        if (!user.avatarUrl && socialData.avatarUrl) user.avatarUrl = socialData.avatarUrl;
        await this.usersService.saveUser(user);
        this.logger.log(`Linked ${authProvider} ID ${socialData.id} to user ${user.id} via phone`);
      }
    }

    // 3. Auto-link theo Email
    if (!user && socialEmail) {
      const userByEmail = await this.usersService.findOneUser({ email: socialEmail });
      if (userByEmail) {
        user = userByEmail;
        if (authProvider === AuthProvidersEnum.zalo) {
          user.zaloId = socialData.id;
        } else {
          user.socialId = socialData.id;
        }
        if (!user.avatarUrl && socialData.avatarUrl) user.avatarUrl = socialData.avatarUrl;
        await this.usersService.saveUser(user);
        this.logger.log(`Linked ${authProvider} ID ${socialData.id} to user ${user.id} via email`);
      }
    }

    // 4. Nếu có user: cập nhật email/avatar/socialId nếu thiếu
    if (user) {
      let changed = false;
      if (socialEmail && !user.email) { user.email = socialEmail; changed = true; }
      if (authProvider === AuthProvidersEnum.zalo && !user.zaloId) { user.zaloId = socialData.id; changed = true; }
      if (authProvider !== AuthProvidersEnum.zalo && !user.socialId) { user.socialId = socialData.id; changed = true; }
      if (!user.avatarUrl && socialData.avatarUrl) { user.avatarUrl = socialData.avatarUrl; changed = true; }
      if (changed) await this.usersService.saveUser(user);
    } else {
      // 5. Tạo user mới
      user = await this.usersService.createUser({
        email: socialEmail ?? null,
        fullName: socialData.fullName ?? null,
        phoneNumber: socialData.phoneNumber ?? null,
        avatarUrl: socialData.avatarUrl ?? null,
        socialId: socialData.id,
        zaloId: authProvider === AuthProvidersEnum.zalo ? socialData.id : null,
        provider: authProvider,
        status: UserStatus.Active,
      });
    }

    if (!user) {
      throw new HttpException(
        { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { user: 'userNotFound' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (user.isDeleted) throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
    if (user.isBlocked) throw new UnauthorizedException('Tài khoản đã bị khóa');

    const session = await this.sessionService.create({ user });
    user.lastLoginAt = new Date();
    await this.usersService.saveUser(user);

    const { token, refreshToken, tokenExpires } = await this.authTokenService.getTokensData({
      id: user.id,
      sessionId: session.id,
    });

    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_LOGIN_SUCCESS,
      message: `Người dùng đăng nhập thành công qua ${authProvider}`,
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });

    return { refreshToken, token, tokenExpires, user };
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  async registerUser(registerDto: AuthRegisterDto): Promise<void> {
    const email = (registerDto.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new HttpException('Vui lòng nhập địa chỉ email hợp lệ để đăng ký.', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.usersService.findOneUser({ email });
    if (existing?.status === UserStatus.Active) {
      throw new HttpException('Email này đã được sử dụng.', HttpStatus.CONFLICT);
    }

    // Nếu người dùng cung cấp thêm số điện thoại, kiểm tra SĐT không bị trùng với tài khoản active khác
    if (registerDto.phoneNumber) {
      const existingPhone = await this.usersService.findByPhoneVariants(
        normalizePhoneVariants(registerDto.phoneNumber),
      );
      if (existingPhone && existingPhone.id !== existing?.id && existingPhone.status === UserStatus.Active) {
        throw new HttpException('Số điện thoại này đã được sử dụng.', HttpStatus.CONFLICT);
      }
    }

    const otp = this.authOtpService.generateOtp();

    // ── Đăng ký bằng Email ──
    let userId: string;
    if (existing) {
      existing.password = registerDto.password;
      existing.fullName = registerDto.fullName;
      if (registerDto.phoneNumber) existing.phoneNumber = registerDto.phoneNumber;
      existing.role = UserRole.Patient;
      existing.status = UserStatus.Inactive;
      const updated = await this.usersService.saveUser(existing);
      userId = updated.id;
    } else {
      const newUser = await this.usersService.createUser({
        ...registerDto,
        email,
        status: UserStatus.Inactive,
        role: UserRole.Patient,
      });
      userId = newUser.id;
    }

    await this.authOtpService.storeOtp('reg', email, otp);

    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_REGISTERED,
      message: `Đăng ký tài khoản mới qua email ${email}`,
      actorEmail: email,
      targetType: 'user',
      targetId: userId,
    });

    await this.mailsService.confirmRegisterUser({
      to: email,
      data: { otp, user: registerDto.fullName, expiresInMinutes: 10 },
    });
  }

  async verifyRegistrationOtp(rawEmail: string, otp: string): Promise<void> {
    const email = (rawEmail || '').trim().toLowerCase();
    const user = await this.usersService.findOneUser({ email });

    if (!user || user.status === UserStatus.Active) {
      throw new HttpException('Tài khoản không hợp lệ hoặc đã được kích hoạt', HttpStatus.BAD_REQUEST);
    }

    await this.authOtpService.verifyOtp('reg', email, otp);

    user.status = UserStatus.Active;
    await this.usersService.saveUser(user);
    await this.authOtpService.deleteOtp('reg', email);
  }

  async resendRegistrationOtp(rawEmail: string): Promise<void> {
    const email = (rawEmail || '').trim().toLowerCase();
    const user = await this.usersService.findOneUser({ email });

    if (!user) throw new HttpException('Không tìm thấy tài khoản', HttpStatus.NOT_FOUND);
    if (user.status === UserStatus.Active) throw new HttpException('Tài khoản đã được kích hoạt', HttpStatus.CONFLICT);

    await this.authOtpService.checkCooldown('reg', email);

    const otp = this.authOtpService.generateOtp();
    await this.authOtpService.storeOtp('reg', email, otp);

    await this.mailsService.confirmRegisterUser({
      to: email,
      data: { otp, user: user.fullName ?? undefined, expiresInMinutes: 10 },
    });
  }

  // ─── Account Status ───────────────────────────────────────────────────────

  async status(userJwtPayload: JwtPayloadType): Promise<NullableType<User>> {
    const user = await this.usersService.findOneUser({ id: userJwtPayload.id });
    if (!user) throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    if (user.isDeleted) throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
    if (user.isBlocked) throw new UnauthorizedException('Tài khoản đã bị khóa');
    return user;
  }

  async confirmEmail(hash: string): Promise<void> {
    const user = await this.usersService.findOneUser({ hash });
    if (!user) {
      throw new HttpException({ status: HttpStatus.NOT_FOUND, error: 'notFound' }, HttpStatus.NOT_FOUND);
    }
    user.hash = null;
    user.status = UserStatus.Active;
    await this.usersService.saveUser(user);
  }

  // ─── Password Management ──────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findOneUser({ email });
    if (!user) {
      throw new HttpException(
        { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { email: 'emailNotExists' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const hash = createHash('sha256').update(randomStringGenerator()).digest('hex');
    await this.passwordResetService.create(hash, user.id);

    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_FORGOT_PASSWORD_REQUESTED,
      message: 'Yêu cầu quên mật khẩu',
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });

    await this.mailsService.forgotPassword({
      to: email,
      data: { hash, user: user.fullName ?? user.email ?? 'User' },
    });
  }

  async resetPassword(hash: string, password: string): Promise<void> {
    this.logger.log(`Reset password requested, hash=${hash ? `${hash.slice(0, 8)}...` : 'missing'}`);

    const resetRecord = await this.passwordResetService.findOne(hash);
    if (!resetRecord) {
      this.logger.warn(`Reset password failed: reset token not found or expired`);
      throw new HttpException(
        { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { hash: 'notFound' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const user = await this.usersService.findOneUser({ id: resetRecord.userId });
    if (!user) {
      this.logger.warn(`Reset password failed: user not found for userId=${resetRecord.userId}`);
      throw new HttpException(
        { status: HttpStatus.UNPROCESSABLE_ENTITY, errors: { hash: 'notFound' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    user.password = password;
    await this.sessionService.softDelete({ user: { id: user.id } });
    await this.tokenBlacklistService.revokeUser(user.id);
    await this.usersService.saveUser(user);
    await this.passwordResetService.remove(hash);

    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_RESET_PASSWORD_SUCCESS,
      message: 'Đặt lại mật khẩu thành công',
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });

    this.logger.log(`Reset password succeeded for userId=${user.id}`);
  }

  // ─── Token delegates (giữ backward-compat với IAuthService) ──────────────

  refreshToken(data: Pick<JwtRefreshPayloadType, 'sessionId' | 'id'>): Promise<Omit<LoginResponseType, 'user'>> {
    return this.authTokenService.refreshBySession(data);
  }

  refreshTokenFromCookie(refreshToken: string): Promise<Omit<LoginResponseType, 'user'>> {
    return this.authTokenService.refreshFromCookie(refreshToken);
  }

  logout(data: { sessionId?: string; token?: string }): Promise<void> {
    return this.authTokenService.logout(data);
  }
}
