import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateSessionDto } from './create-session.dto';

export class UpdateSessionDto extends PartialType(CreateSessionDto) {
  /**
   * Ripple this edit down the room. When the start time moves, every later
   * session in the same room on the same day moves by the same amount, so a
   * keynote pushed back 20 minutes is one edit, not six. Off by default:
   * a correction to a single wrong time must not drag the rest of the day.
   */
  @ApiPropertyOptional({
    description:
      'Shift every later session in this room and day by the change in start time',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  shiftFollowing?: boolean;
}
