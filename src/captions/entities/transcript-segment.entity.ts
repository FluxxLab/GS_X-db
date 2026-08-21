import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TranscriptSource {
  AI = 'ai',
  HUMAN = 'human',
}

@Entity('transcript_segments')
export class TranscriptSegment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  sessionId: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 255 })
  room: string;

  /**
   * Diarised voice index from the transcription provider, 0-based. Nullable:
   * a provider that cannot attribute a segment is not an error, and the
   * numbering restarts whenever the room's stream reopens, so it identifies a
   * voice within one capture run rather than a person across the summit.
   */
  @Column({ type: 'smallint', nullable: true })
  speaker: number | null;

  @Column({
    type: 'enum',
    enum: TranscriptSource,
    default: TranscriptSource.AI,
  })
  source: TranscriptSource;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
