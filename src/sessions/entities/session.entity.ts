import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Speaker } from './speaker.entity';

/**
 * The summit's five thematic tracks, confirmed 22 Aug 2026.
 *
 * Replaced an earlier seven that included plenary, innovation and youth.
 * These values are the Postgres enum for both sessions and pitch entries, so
 * adding or removing one is a migration, not an edit here.
 */
export enum SessionTrack {
  DIGITAL = 'digital',
  ECONOMIC = 'economic',
  GBV = 'gbv',
  HEALTH = 'health',
  SECURITY = 'security',
}

/**
 * Display names for the tracks. Lives beside the enum so adding a track is one
 * edit plus a migration, and every client picks up the label from the API.
 */
export const TRACK_LABELS: Record<SessionTrack, string> = {
  [SessionTrack.DIGITAL]: 'Inclusive Digital Transformation',
  [SessionTrack.ECONOMIC]: 'Economic Inclusion',
  [SessionTrack.GBV]: 'Gender-Based Violence (GBV)',
  [SessionTrack.HEALTH]: 'Health & Nutrition',
  [SessionTrack.SECURITY]: 'Security & Transportation',
};

export enum SessionStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  COMPLETED = 'completed',
}

@Entity('sessions')
@Index('idx_session_day_track', ['day', 'track'])
@Index('idx_session_status', ['status'])
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'int' })
  day: number;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz' })
  endsAt: Date;

  @Column({ type: 'enum', enum: SessionTrack })
  track: SessionTrack;

  @Column({
    type: 'enum',
    enum: SessionStatus,
    default: SessionStatus.SCHEDULED,
  })
  status: SessionStatus;

  @Column({ type: 'varchar', length: 255 })
  type: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  audience: string | null;

  @Column({ type: 'varchar', length: 255 })
  room: string;

  @ManyToMany(() => Speaker, { cascade: false })
  @JoinTable({ name: 'session_speakers' })
  speakers: Speaker[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
