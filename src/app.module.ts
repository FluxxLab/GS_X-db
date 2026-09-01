import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RolesGuard } from './common/guards/roles.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { SessionsModule } from './sessions/sessions.module';
import { SpeakerRevealInterceptor } from './sessions/speaker-reveal.interceptor';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { DelegateModule } from './delegate/delegate.module';
import { ResourcesModule } from './resources/resources.module';
import { validateEnv } from './config/env.validation';
import { RealtimeModule } from './common/realtime/realtime.module';
import { RedisModule } from './common/redis/redis.module';
import { VotingModule } from './voting/voting.module';
import { TriviaModule } from './trivia/trivia.module';
import { DiscussionsModule } from './discussions/discussions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditInterceptor } from './common/audit.interceptor';
import { SecurityModule } from './security/security.module';
import { AdminModule } from './admin/admin.module';
import { LiveOpsModule } from './live-ops/live-ops.module';
import { CaptionsModule } from './captions/captions.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    /**
     * Infrastructure
     */
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.getOrThrow<number>('DB_PORT'),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
        },
      }),
    }),
    /**
     * Feature modules
     */
    AuthModule,
    DelegateModule,
    SessionsModule,
    RealtimeModule,
    RedisModule,
    VotingModule,
    TriviaModule,
    DiscussionsModule,
    NotificationsModule,
    SecurityModule,
    AdminModule,
    LiveOpsModule,
    CaptionsModule,
    ResourcesModule,
    SearchModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Withholds speaker identities from every response until they are
    // revealed, so a new endpoint returning a session is covered by default
    // rather than by someone remembering to redact it.
    { provide: APP_INTERCEPTOR, useClass: SpeakerRevealInterceptor },
  ],
})
export class AppModule {}
