import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { IUsersService } from '../users/users';
import { Services } from 'src/common/utils/constants';
import { AuthEmailLoginDto } from './dtos/auth-email-login.dto';
import { LoginResponseType } from './types/login-response.type';
import { AuthProvidersEnum } from './enums/auth-providers.enum';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { ttlToMilliseconds } from '../../../config/auth.config';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { ISessionService } from '../session/session';
import { Session } from '../session/entities/session.entity';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../../config/config.type';
import { JwtService } from '@nestjs/jwt';
import { IAuthService } from './auth';
import { AuthRegisterDto } from './dtos/auth-register.dto';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { compareHash } from 'src/common/utils/helpers';
import { IMailsService } from '../../mails/mails';
import { JwtPayloadType } from './strategies/types/jwt-payload.type';
import { NullableType } from 'src/common/utils/types/nullable.type';
import { IForgotPasswordService } from '../forgot-password/forgot-password';
import { SocialType } from '../../../common/utils/social.type';
import { JwtRefreshPayloadType } from './strategies/types/jwt-refresh-payload.type';
import { HistoryService } from '../../history/history.service';
import { HISTORY_ACTIONS } from '../../history/history';
import { RedisService } from '../../../infrastructure/cache/redis/redis.service.js';
import { TokenBlacklistService } from '../jwt-auth-core/token-blacklist.service.js';

@Injectable()
export class AuthService implements IAuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(Services.USERS) private readonly usersService: IUsersService,
    @Inject(Services.MAILS) private readonly mailsService: IMailsService,
    @Inject(Services.SESSION) private readonly sessionService: ISessionService,
    @Inject(Services.FORGOT_PASSWORD)
    private readonly forgotPasswordService: IForgotPasswordService,
    private readonly historyService: HistoryService,
    private readonly redis: RedisService,
    private readonly tokenBlacklistService: TokenBlacklistService,

    private readonly configService: ConfigService<AllConfigType>,
    private readonly jwtService: JwtService,
  ) { }

  async checkEmail(email: string): Promise<boolean> {

    const user = await this.usersService.findByEmail(email);
    return !user;
  }

  async validateLogin(loginDto: AuthEmailLoginDto): Promise<LoginResponseType> {
    const rawInput = (loginDto.email || '').trim();
    const isEmail = rawInput.includes('@');

    let user: User | null = null;
    if (isEmail) {
      user = await this.usersService.findOneUser({
        email: rawInput.toLowerCase(),
      });
    } else {
      const phoneNorm = rawInput.startsWith('0') ? `+84${rawInput.slice(1)}` : rawInput;
      const phoneRaw0 = rawInput.startsWith('+84') ? `0${rawInput.slice(3)}` : rawInput;
      user =
        (await this.usersService.findOneUser({ phoneNumber: rawInput } as any)) ||
        (await this.usersService.findOneUser({ phoneNumber: phoneNorm } as any)) ||
        (await this.usersService.findOneUser({ phoneNumber: phoneRaw0 } as any)) ||
        (await this.usersService.findOneUser({ email: `${rawInput.replace(/[\s\+]/g, '')}@phone.vitacare.vn` }));
    }

    if (!user) {
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            email: 'notFound',
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const authProvider = user.provider ?? AuthProvidersEnum.email;
    if (authProvider !== AuthProvidersEnum.email) {
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            email: `needLoginViaProvider:${authProvider}`,
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (user.status !== UserStatus.Active) {
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            email: 'inactive',
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (user.isDeleted) {
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
    }

    if (user.isBlocked) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    const isValidPassword = await compareHash(loginDto.password, user.password);

    if (!isValidPassword) {
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            password: 'incorrectPassword',
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    user.lastLoginAt = new Date();
    await this.usersService.saveUser(user);

    const session = await this.sessionService.create({
      user,
    });

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: user.id,
      sessionId: session.id,
    });
    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_LOGIN_SUCCESS,
      message: `Người dùng đăng nhập thành công`,
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });

    return {
      refreshToken,
      token,
      tokenExpires,
      user,
    };
  }
  async validateSocialLogin(
    authProvider: AuthProvidersEnum,
    socialData: SocialType,
  ): Promise<LoginResponseType> {
    let user: NullableType<User>;
    const socialEmail = socialData.email?.toLowerCase();

    const userByEmail = await this.usersService.findOneUser({
      email: socialEmail,
    });

    user = await this.usersService.findOneUser({
      socialId: socialData.id,
      provider: authProvider,
    });

    if (user) {
      if (socialEmail && !userByEmail) {
        user.email = socialEmail;
      }
      await this.usersService.saveUser(user);
    } else if (userByEmail) {
      user = userByEmail;
    } else {
      user = await this.usersService.createUser({
        email: socialEmail ?? null,
        fullName: socialData.fullName ?? null,
        socialId: socialData.id,
        provider: authProvider,
        status: UserStatus.Active,
      });

      user = await this.usersService.findOneUser({
        id: user.id,
      });
    }

    if (!user) {
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            user: 'userNotFound',
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (user.isDeleted) {
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
    }

    if (user.isBlocked) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    const session = await this.sessionService.create({
      user,
    });

    user.lastLoginAt = new Date();
    await this.usersService.saveUser(user);

    const {
      token: jwtToken,
      refreshToken,
      tokenExpires,
    } = await this.getTokensData({
      id: user.id,
      sessionId: session.id,
    });

    return {
      refreshToken,
      token: jwtToken,
      tokenExpires,
      user,
    };
  }

  async registerUser(registerDto: AuthRegisterDto): Promise<void> {
    const rawAccount = (registerDto.email || '').trim();
    const isEmail = rawAccount.includes('@');
    const email = isEmail ? rawAccount.toLowerCase() : null;
    const phoneNumber = !isEmail ? rawAccount : (registerDto.phoneNumber || null);

    if (email) {
      const existingUser = await this.usersService.findOneUser({ email });
      if (existingUser?.status === UserStatus.Active) {
        throw new HttpException('Email này đã được sử dụng.', HttpStatus.CONFLICT);
      }
    }

    if (phoneNumber) {
      const phoneNorm = phoneNumber.startsWith('0') ? `+84${phoneNumber.slice(1)}` : phoneNumber;
      const phoneRaw0 = phoneNumber.startsWith('+84') ? `0${phoneNumber.slice(3)}` : phoneNumber;
      const existingPhoneUser =
        (await this.usersService.findOneUser({ phoneNumber } as any)) ||
        (await this.usersService.findOneUser({ phoneNumber: phoneNorm } as any)) ||
        (await this.usersService.findOneUser({ phoneNumber: phoneRaw0 } as any));

      if (existingPhoneUser?.status === UserStatus.Active) {
        throw new HttpException('Số điện thoại này đã được sử dụng.', HttpStatus.CONFLICT);
      }
    }

    // Nếu đăng ký bằng số điện thoại: kích hoạt luôn tài khoản để bệnh nhân đăng nhập ngay lập tức!
    if (!isEmail && phoneNumber) {
      const virtualEmail = `${phoneNumber.replace(/[\s\+]/g, '')}@phone.vitacare.vn`;
      await this.usersService.createUser({
        fullName: registerDto.fullName,
        password: registerDto.password,
        email: virtualEmail,
        phoneNumber,
        status: UserStatus.Active,
        role: UserRole.Patient,
      } as any);

      await this.historyService.create({
        action: HISTORY_ACTIONS.USER_REGISTERED,
        message: `Đăng ký tài khoản mới bằng số điện thoại ${phoneNumber}`,
        actorEmail: phoneNumber,
        targetType: 'user',
        targetId: phoneNumber,
      });
      return;
    }

    // Nếu đăng ký bằng email: gửi mã OTP qua Gmail và lưu vào Redis
    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);

    // Lưu OTP vào Redis với TTL 10 phút (600s), cooldown chống spam 60s
    if (this.redis.isEnabled()) {
      await this.redis.set(`auth:otp:reg:${email}`, { hash: otpHash, attempts: 0 }, 600);
      await this.redis.set(`auth:otp:cooldown:${email}`, '1', 60);
    }

    const existingUser = email ? await this.usersService.findOneUser({ email }) : null;
    if (existingUser) {
      existingUser.password = registerDto.password;
      existingUser.fullName = registerDto.fullName;
      existingUser.role = UserRole.Patient;
      existingUser.status = UserStatus.Inactive;
      await this.usersService.saveUser(existingUser);
    } else {
      await this.usersService.createUser({
        ...registerDto,
        email: email!,
        status: UserStatus.Inactive,
        role: UserRole.Patient,
      });
    }
    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_REGISTERED,
      message: `Đăng ký tài khoản mới qua email ${email}`,
      actorEmail: email!,
      targetType: 'user',
      targetId: email!,
    });

    await this.mailsService.confirmRegisterUser({
      to: email!,
      data: { otp, user: registerDto.fullName, expiresInMinutes: 10 },
    });
  }

  async verifyRegistrationOtp(email: string, otp: string): Promise<void> {
    const user = await this.usersService.findOneUser({ email });
    if (!user || user.status === UserStatus.Active) {
      throw new HttpException('Tài khoản không hợp lệ hoặc đã được kích hoạt', HttpStatus.BAD_REQUEST);
    }

    if (!this.redis.isEnabled()) {
      throw new HttpException('Hệ thống xác thực tạm thời gián đoạn', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const otpKey = `auth:otp:reg:${email}`;
    const otpData = await this.redis.get<{ hash: string; attempts: number }>(otpKey);

    if (!otpData || !otpData.hash) {
      throw new HttpException('Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng gửi lại OTP mới.', HttpStatus.BAD_REQUEST);
    }

    if ((otpData.attempts || 0) >= 5) {
      throw new HttpException(
        'Mã OTP đã bị khóa do nhập sai quá nhiều lần. Vui lòng gửi lại OTP mới.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const suppliedHash = this.hashOtp(otp);
    const expected = Buffer.from(otpData.hash, 'hex');
    const supplied = Buffer.from(suppliedHash, 'hex');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      otpData.attempts = (otpData.attempts || 0) + 1;
      await this.redis.set(otpKey, otpData, 600);
      throw new HttpException('Mã OTP không chính xác', HttpStatus.BAD_REQUEST);
    }

    user.status = UserStatus.Active;
    await this.usersService.saveUser(user);
    await this.redis.delete(otpKey);
  }

  async resendRegistrationOtp(email: string): Promise<void> {
    const user = await this.usersService.findOneUser({ email });
    if (!user) {
      throw new HttpException('Không tìm thấy tài khoản', HttpStatus.NOT_FOUND);
    }
    if (user.status === UserStatus.Active) {
      throw new HttpException('Email đã được xác thực', HttpStatus.CONFLICT);
    }

    const cooldownKey = `auth:otp:cooldown:${email}`;
    if (this.redis.isEnabled() && (await this.redis.exists(cooldownKey))) {
      throw new HttpException(
        'Vui lòng chờ 60 giây trước khi gửi lại OTP',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);

    if (this.redis.isEnabled()) {
      await this.redis.set(`auth:otp:reg:${email}`, { hash: otpHash, attempts: 0 }, 600);
      await this.redis.set(cooldownKey, '1', 60);
    }

    await this.mailsService.confirmRegisterUser({
      to: email,
      data: { otp, user: user.fullName ?? undefined, expiresInMinutes: 10 },
    });
  }

  async status(userJwtPayload: JwtPayloadType): Promise<NullableType<User>> {
    const user = await this.usersService.findOneUser({
      id: userJwtPayload.id,
    });
    if (!user) {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
    if (user.isDeleted) {
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
    }
    if (user.isBlocked) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }
    return user;
  }

  async confirmEmail(hash: string): Promise<void> {
    const user = await this.usersService.findOneUser({
      hash,
    });

    if (!user) {
      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error: `notFound`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    user.hash = null;
    user.status = UserStatus.Active;
    await this.usersService.saveUser(user);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findOneUser({
      email,
    });

    if (!user) {
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            email: 'emailNotExists',
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const hash = createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    await this.forgotPasswordService.create({
      hash,
      user,
      userId: user.id,
    });
    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_FORGOT_PASSWORD_REQUESTED,
      message: `Yêu cầu quên mật khẩu`,
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });

    await this.mailsService.forgotPassword({
      to: email,
      data: {
        hash,
        user: user.fullName ?? user.email ?? 'User',
      },
    });
  }

  async resetPassword(hash: string, password: string): Promise<void> {
    this.logger.log(
      `Reset password requested, hash=${hash ? `${hash.slice(0, 8)}...` : 'missing'}, passwordLength=${password?.length ?? 0}`,
    );

    const forgotReq = await this.forgotPasswordService.findOne({
      where: {
        hash,
      },
    });

    if (!forgotReq) {
      this.logger.warn(
        `Reset password failed: forgot request not found for hash=${hash ? `${hash.slice(0, 8)}...` : 'missing'}`,
      );
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            hash: `notFound`,
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const forgotReqWithRawUser = forgotReq as typeof forgotReq & {
      user?:
      | (User & {
        _id?:
        | { toString?: () => string }
        | { $oid?: string }
        | string
        | null;
      })
      | User['id']
      | null;
      userId?: User['id'];
    };
    const userIdFromRelation = this.resolveUserIdFromUnknown(
      forgotReqWithRawUser.user,
    );
    const userIdFromPrimitive =
      typeof forgotReqWithRawUser.user === 'string'
        ? forgotReqWithRawUser.user
        : undefined;
    const userId =
      userIdFromRelation ??
      userIdFromPrimitive ??
      forgotReqWithRawUser.userId ??
      undefined;

    if (!userId) {
      this.logger.warn(
        `Reset password failed: missing user reference in forgot request id=${forgotReq.id}`,
      );
    }
    const userSnapshot =
      forgotReqWithRawUser.user && typeof forgotReqWithRawUser.user === 'object'
        ? forgotReqWithRawUser.user
        : undefined;
    const user = userId
      ? await this.usersService.findOneUser({
        id: userId,
      })
      : userSnapshot?.email
        ? await this.usersService.findOneUser({
          email: userSnapshot.email,
        })
        : null;

    if (!user) {
      this.logger.warn(
        `Reset password failed: user not found for userId=${userId}, forgotRequestId=${forgotReq.id}`,
      );
      throw new HttpException(
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            hash: `notFound`,
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    this.logger.log(
      `Reset password updating userId=${user.id}, forgotRequestId=${forgotReq.id}`,
    );
    user.password = password;

    await this.sessionService.softDelete({
      user: {
        id: user.id,
      },
    });
    // Thu hồi tức thì toàn bộ token đã cấp trước đó của user này
    await this.tokenBlacklistService.revokeUser(user.id);
    await this.usersService.saveUser(user);
    await this.forgotPasswordService.softDelete(forgotReq.id);
    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_RESET_PASSWORD_SUCCESS,
      message: `Đặt lại mật khẩu thành công`,
      actorId: user.id,
      actorEmail: user.email ?? undefined,
      targetType: 'user',
      targetId: user.id,
    });
    this.logger.log(
      `Reset password succeeded for userId=${user.id}, forgotRequestId=${forgotReq.id}`,
    );
  }

  async refreshToken(
    data: Pick<JwtRefreshPayloadType, 'sessionId' | 'id'>,
  ): Promise<Omit<LoginResponseType, 'user'>> {
    this.logger.log(
      `Refreshing token for sessionId=${data.sessionId ?? 'missing'}`,
    );

    const session = await this.sessionService.findOne({
      where: {
        id: data.sessionId,
      },
    });

    if (!session) {
      this.logger.warn(
        `Refresh failed: session not found for sessionId=${data.sessionId ?? 'missing'}`,
      );
      throw new UnauthorizedException();
    }

    const sessionWithRawUser = session as Session & {
      user?: { id?: User['id'] } | User['id'] | null;
      userId?: User['id'];
    };
    const userIdFromRelation =
      typeof sessionWithRawUser.user === 'object' &&
        sessionWithRawUser.user !== null
        ? sessionWithRawUser.user.id
        : undefined;
    const userIdFromPrimitive =
      typeof sessionWithRawUser.user === 'string'
        ? sessionWithRawUser.user
        : undefined;
    const userId =
      userIdFromRelation ??
      userIdFromPrimitive ??
      data.id ??
      sessionWithRawUser.userId ??
      undefined;

    if (!userId) {
      this.logger.warn(
        `Refresh failed: missing user reference for sessionId=${session.id}`,
      );
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findOneUser({ id: userId });
    if (!user) {
      this.logger.warn(
        `Refresh failed: user not found for userId=${userId}, sessionId=${session.id}`,
      );
      throw new UnauthorizedException();
    }
    if (user.isDeleted) {
      this.logger.warn(
        `Refresh failed: user deleted for userId=${userId}, sessionId=${session.id}`,
      );
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
    }
    if (user.isBlocked) {
      this.logger.warn(
        `Refresh failed: user blocked for userId=${userId}, sessionId=${session.id}`,
      );
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: userId,
      sessionId: session.id,
    });

    this.logger.log(
      `Refresh succeeded for userId=${userId}, sessionId=${session.id}, tokenExpires=${tokenExpires}`,
    );

    return {
      token,
      refreshToken,
      tokenExpires,
    };
  }

  async refreshTokenFromCookie(
    refreshToken: string,
  ): Promise<Omit<LoginResponseType, 'user'>> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtRefreshPayloadType>(
        refreshToken,
        {
          secret: this.configService.getOrThrow<string>('auth.refreshSecret', {
            infer: true,
          }),
        },
      );

      return this.refreshToken({
        sessionId: payload.sessionId,
        id: payload.id,
      });
    } catch (error) {
      this.logger.warn('Refresh token verification failed from cookie', error);
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }
  }

  async logout(data: { sessionId?: string; token?: string }): Promise<void> {
    if (data.sessionId) {
      await this.sessionService.softDelete({
        id: data.sessionId,
      });
    }

    if (data.token) {
      try {
        const decoded = this.jwtService.decode(data.token) as { exp?: number };
        await this.tokenBlacklistService.blacklistToken(data.token, decoded?.exp);
      } catch (err: any) {
        this.logger.warn(`Failed to blacklist token on logout: ${err?.message}`);
      }
    }
  }

  private async getTokensData(data: {
    id: User['id'];
    sessionId: Session['id'];
  }) {
    const tokenExpiresIn = this.configService.getOrThrow<string>(
      'auth.expires',
      {
        infer: true,
      },
    );

    const tokenExpires = Date.now() + this.parseDurationToMs(tokenExpiresIn);

    const [token, refreshToken] = await Promise.all([
      await this.jwtService.signAsync(
        {
          id: data.id,
          sessionId: data.sessionId,
        },
        {
          secret: this.configService.getOrThrow<string>('auth.secret', {
            infer: true,
          }),
          expiresIn: tokenExpiresIn as never,
        },
      ),
      await this.jwtService.signAsync(
        {
          id: data.id,
          sessionId: data.sessionId,
        },
        {
          secret: this.configService.getOrThrow<string>('auth.refreshSecret', {
            infer: true,
          }),
          expiresIn: this.configService.getOrThrow<string>(
            'auth.refreshExpires',
            {
              infer: true,
            },
          ) as never,
        },
      ),
    ]);

    return {
      token,
      refreshToken,
      tokenExpires,
    };
  }

  private generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  private parseDurationToMs(duration: string): number {
    try {
      return ttlToMilliseconds(duration);
    } catch {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          errors: {
            auth: `invalidTokenExpires:${duration}`,
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private resolveUserIdFromUnknown(userValue: unknown): User['id'] | undefined {
    if (!userValue) {
      return undefined;
    }

    if (typeof userValue === 'string') {
      return userValue;
    }

    if (typeof userValue !== 'object') {
      return undefined;
    }

    const userRecord = userValue as {
      id?: unknown;
      _id?: unknown;
    };
    if (typeof userRecord.id === 'string' && userRecord.id.length > 0) {
      return userRecord.id;
    }

    if (typeof userRecord._id === 'string' && userRecord._id.length > 0) {
      return userRecord._id;
    }

    if (
      userRecord._id &&
      typeof userRecord._id === 'object' &&
      '$oid' in userRecord._id
    ) {
      const mongoOid = userRecord._id as { $oid?: unknown };
      if (typeof mongoOid.$oid === 'string' && mongoOid.$oid.length > 0) {
        return mongoOid.$oid;
      }
    }

    if (
      userRecord._id &&
      typeof userRecord._id === 'object' &&
      'toString' in userRecord._id
    ) {
      const mongoObjectId = userRecord._id as { toString?: () => string };
      const rawObjectId = mongoObjectId.toString?.();
      if (
        rawObjectId &&
        rawObjectId !== '[object Object]' &&
        rawObjectId.length > 0
      ) {
        return rawObjectId;
      }
    }

    return undefined;
  }
}
