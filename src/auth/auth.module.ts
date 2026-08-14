import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { DelegateModule } from 'src/delegate/delegate.module';
import { JwtStrategy } from './strategies/jwt.stategies';
import { SessionsGateway } from 'src/sessions/sessions.gateway';
import { OtpService } from './otp.service';
import { NotificationsModule } from 'src/notifications/notifications.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    DelegateModule,
    NotificationsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<number>('JWT_EXPIRES_IN'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SessionsGateway, OtpService],
  exports: [JwtModule, OtpService],
})
export class AuthModule {}
