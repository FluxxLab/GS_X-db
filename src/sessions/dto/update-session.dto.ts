import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateSessionDto } from './create-session.dto';

export class UpdateSessionDto extends PartialType(CreateSessionDto) {
  /**
   * One room holds one session at a time. When this edit would land on a
   * later session in the same room and day, push that session - and any it
   * lands on in turn - just far enough to start when the previous one ends,
   * so a keynote pushed back 20 minutes is one edit, not six. Off by
   * default: without it a collision is refused (409) naming the session in
   * the way, so a single wrong time cannot silently drag the rest of the day.
   */
  @ApiPropertyOptional({
    description:
      'Push later sessions in this room and day out of the way if this edit would overlap them; otherwise a collision is refused',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  shiftFollowing?: boolean;
}
