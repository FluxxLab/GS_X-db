import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AudienceSegment } from '../entities/notification.entity';

export class CreateNotificationDto {
    @ApiProperty({maxLength: 255, description: 'Push title shown on the device'})
    @IsString()
    @MaxLength(255)
    title: string;

    @ApiProperty({description: 'Push body / inbox message text'})
    @IsString()
    body: string;

    @ApiPropertyOptional({maxLength: 100, example: 'shedule-change'})
    @IsOptional()
    @IsString()
    @MaxLength(100)
    category: string;

    @ApiProperty({enum: AudienceSegment, example: AudienceSegment.ALL})
    @IsEnum(AudienceSegment)
    segment: AudienceSegment;
}