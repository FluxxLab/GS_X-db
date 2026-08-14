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

export enum SessionTrack {
  PLENARY = 'plenary',
  GBV = 'gbv',
  HEALTH = 'health',
  ECONOMIC = 'economic',
  INNOVATION = 'innovation',
  DIGITAL = 'digital',
  YOUTH = 'youth',
}

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
