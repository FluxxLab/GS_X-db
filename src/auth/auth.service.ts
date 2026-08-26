import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DelegatesService } from 'src/delegate/delegates.service';
import { AccessTier, Delegate } from 'src/delegate/entities/delegate.entity';
import { REDIS } from 'src/common/redis/redis.module';
import Redis from 'ioredis';
import { EventSeverity } from 'src/security/entities/security-event.entity';
import { SecurityService } from 'src/security/security.service';
import { RegisterDto } from './dto/register.dto';
import { OtpService } from './otp.service';

interface RequestContext {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly delegate: DelegatesService,
    private readonly otpService: OtpService,

    @Inject(REDIS)
    private readonly redis: Redis,
    private readonly securityService: SecurityService,
  ) {}

  async login(email: string, password: string, ctx: RequestContext) {
    const delegate = await this.delegate.findByEmailForAuth(email);

    /**
     * Same error for invalid email and  password
     * do not leak which
     */
    if (!delegate || !(await bcrypt.compare(password, delegate.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokens(delegate, ctx);
  }

  async refresh(refreshToken: string, ctx: RequestContext) {
    let payload: { sub: string; jti: string; typ: string };

    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const row = await this.refreshTokenRepository.findOneBy({
      jti: payload.jti,
    });

    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (row.consumedAt) {
      /**
       * reuse of an already rotated token = theft signal (TR-12):
       * revoke everyting this user holds and audits it
       */
      await this.refreshTokenRepository.update(
        { userId: row.userId, revokedAt: IsNull(), consumedAt: IsNull() },
        { revokedAt: new Date() },
      );

      /**
       * TODO(security module ):  write  Security Event{ type: 'refresh_token_reuse', actor: row.userId }
       */
      if (row.consumedAt) {
        /**
         * reuse of an already rotated token = theft signal
         * revoke everything this user holds and audit it
         */
        await this.refreshTokenRepository.update(
          { userId: row.userId, revokedAt: IsNull(), consumedAt: IsNull() },
          { revokedAt: new Date() },
        );

        await this.securityService.record({
          type: 'refresh_token_reuse',
          description:
            'Refresh token reuse detected - all tokens for user revoked',
          actorId: row.userId,
          severity: EventSeverity.CRITICAL,
        });
        throw new UnauthorizedException('Refresh token reuse detected');
      }
    }

    const delegate = await this.delegate.findById(row.userId);

    if (!delegate) throw new UnauthorizedException('User not found');

    const tokens = await this.issueTokens(delegate, ctx);

    await this.refreshTokenRepository.update(row.id, {
      consumedAt: new Date(),
      replacedByJti: tokens.refreshTokenId,
    });

    return tokens;
  }

  async logout(refreshToken: string, accessJti?: string, accessExp?: number) {
    try {
      const payload = await this.jwt.verifyAsync<{ jti: string }>(refreshToken);
      await this.refreshTokenRepository.update(
        { jti: payload.jti },
        { revokedAt: new Date() },
      );
    } catch {
      /**
       * Idemptent
       */
    }

    if (accessJti && accessExp) {
      const ttl = accessExp - Math.floor(Date.now() / 1000);

      if (ttl > 0) await this.redis.set(`bl:${accessJti}`, '1', 'EX', ttl);
    }
  }

  private async issueTokens(delegate: Delegate, ctx: RequestContext) {
    const accessTtl = this.config.getOrThrow<number>('JWT_ACCESS_TTL');
    const refreshTtl = this.config.getOrThrow<number>('JWT_REFRESH_TTL');
    const refreshJti = randomUUID();

    const accessToken = await this.jwt.signAsync(
      { sub: delegate.id, role: delegate.accessTier, jti: randomUUID() },
      { expiresIn: accessTtl },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: delegate.id, typ: 'refresh', jti: refreshJti },
      { expiresIn: refreshTtl },
    );

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId: delegate.id,
        jti: refreshJti,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
      }),
    );

    return {
      accessToken,
      refreshToken,
      refreshTokenId: refreshJti,
    };
  }

  /**
   * Anti-enumeration by design: the response is identical whether the email
   * has an account or not. The OTP email is only actually sent when one
   * exists, so an attacker probing addresses learns nothing from this route.
   */
  async forgotPassword(rawEmail: string): Promise<void> {
    const email = rawEmail.toLowerCase().trim();
    const delegate = await this.delegate.findByEmailForAuth(email);
    if (!delegate) return;
    await this.otpService.requestOtp(
      email,
      'email',
      undefined,
      'password reset',
    );
  }

  /**
   * The OTP is the credential here - it proves inbox control, the same proof
   * registration relies on. On success every live refresh token is revoked:
   * a reset that leaves stolen sessions signed in would defeat its own point.
   */
  async resetPassword(
    rawEmail: string,
    otp: string,
    newPassword: string,
  ): Promise<void> {
    const email = rawEmail.toLowerCase().trim();
    await this.otpService.assertValid(email, otp);

    const delegate = await this.delegate.findByEmailForAuth(email);
    // Generic message on purpose: a distinct "no such account" here would leak
    // what forgotPassword deliberately hides.
    if (!delegate) throw new BadRequestException('Invalid or expired code');

    await this.delegate.updatePassword(
      delegate.id,
      await bcrypt.hash(newPassword, 12),
    );
    await this.refreshTokenRepository.update(
      { userId: delegate.id, revokedAt: IsNull(), consumedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async registration(dto: RegisterDto, ctx: RequestContext) {
    const email = dto.email.toLowerCase();

    if (dto.consent !== true) {
      throw new BadRequestException(
        'consent must be explicitly true (boolean) to register',
      );
    }

    const verifiedVia = await this.otpService.assertValid(email, dto.otp);

    if (await this.delegate.findByEmailForAuth(email)) {
      throw new ConflictException('An account with this email already exists');
    }

    const entry = await this.delegate.matchRegistration(email, dto.inviteCode);
    if (dto.inviteCode && !entry) {
      throw new BadRequestException('Invalid or already-used invite code');
    }

    // tier-by-email-match demands inbox proof — SMS possession is not that proof
    const matchedByEmail = entry && !dto.inviteCode;
    if (matchedByEmail && verifiedVia !== 'email') {
      throw new BadRequestException(
        'This email is pre-registered — please verify using the email code option',
      );
    }

    const delegate = await this.delegate.createDelegate({
      name: dto.name,
      email,
      passwordHash: await bcrypt.hash(dto.password, 12),
      accessTier: entry?.assignedTier ?? AccessTier.STANDARD,
      pendingReview: !entry,
      phone: dto.phone ?? null,
      consentAt: new Date(),
    });

    if (entry) await this.delegate.claimRegistration(entry.id, delegate.id);

    await this.securityService.record({
      type: 'delegate_registered',
      description: entry
        ? `Registration matched list entry — tier ${delegate.accessTier} granted`
        : 'Unmatched registration — standard tier, pending review',
      actorId: delegate.id,
      severity: EventSeverity.INFO,
      metadata: { matched: !!entry, tier: delegate.accessTier, verifiedVia },
    });

    return this.issueTokens(delegate, ctx);
  }

  async issuePass(delegateId: string) {
    const delegate = await this.delegate.findById(delegateId);
    if (!delegate) {
      throw new UnauthorizedException();
    }

    const pass = await this.jwt.signAsync(
      { sub: delegate.id, tier: delegate.accessTier, type: 'pass' },
      { expiresIn: 300 },
    );
    return { pass, expiresInSec: 300 };
  }

  async varifyPass(passToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ?: string }>(
        passToken,
      );
      if (payload.typ !== 'pass') {
        throw new Error('not a pass');
      }

      const delegate = await this.delegate.findById(payload.sub);
      if (!delegate) {
        throw new Error('unknown delegate');
      }

      return {
        valid: true as const,
        name: delegate.name,
        organisation: delegate.organisation,
        tier: delegate.accessTier,
        flagged: delegate.flagged,
      };
    } catch {
      await this.securityService.record({
        type: 'pass_verification_failed',
        description: 'Invalid or expired QR pass presented at a gate',
        severity: EventSeverity.WARNING,
      });
      return {
        valid: false as const,
      };
    }
  }
}
