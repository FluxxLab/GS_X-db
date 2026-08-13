import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityEvent } from './entities/security-event.entity';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

@Global() // infrastructure-like: many modules write audit events
@Module({
  imports: [TypeOrmModule.forFeature([SecurityEvent])],
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
