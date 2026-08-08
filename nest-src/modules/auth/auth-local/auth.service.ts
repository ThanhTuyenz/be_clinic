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
import { createHash } from 'crypto';
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

    private readonly configService: ConfigService<AllConfigType>,
    private readonly jwtService: JwtService,
  ) { }

  async checkEmail(email: string): Promise<boolean> {

    console.log("email nahn duco ", email)
    const user = await this.usersService.findByEmail(email);

    console.log('user ', user)
    return !user;
  }

  async validateLogin(loginDto: AuthEmailLoginDto): Promise<LoginResponseType> {
    const user = await this.usersService.findOneUser({
      email: loginDto.email,
    });

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
    const hash = createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    await this.usersService.createUser({
      ...registerDto,
      email: registerDto.email,
      status: UserStatus.Active,
      role: UserRole.User,
      hash,
    });
    await this.historyService.create({
      action: HISTORY_ACTIONS.USER_REGISTERED,
      message: `Đăng ký tài khoản mới`,
      actorEmail: registerDto.email,
      targetType: 'user',
      targetId: registerDto.email,
    });

    // try {
    //   await this.mailsService.confirmRegisterUser({
    //     to: registerDto.email,
    //     data: {
    //       hash,
    //       user: registerDto.fullName,
    //     },
    //   });
    // } catch (error) {
    //   this.logger.warn(
    //     `Register mail send failed for ${registerDto.email}.`,
    //     error instanceof Error ? error.stack : undefined,
    //   );
    // }
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

  async logout(data: Pick<JwtRefreshPayloadType, 'sessionId'>) {
    return this.sessionService.softDelete({
      id: data.sessionId,
    });
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
