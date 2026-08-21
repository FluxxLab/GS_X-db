import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateSessionDto } from './create-session.dto';
import { SessionStatus } from '../entities/session.entity';

export class UpdateSessionDto extends PartialType(CreateSessionDto) {
    @ApiPropertyOptional({ enum: SessionStatus })
    @IsOptional()
    @IsEnum(SessionStatus)
    status?: SessionStatus;
}
