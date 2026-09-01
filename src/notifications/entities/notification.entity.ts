import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AudienceSegment {
  ALL = 'all',
  VIP = 'vip',
  PRESS = 'press',
  SPEAKERS = 'speakers',
  VOLUNTEERS = 'volunteers',
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'enum', enum: AudienceSegment, default: AudienceSegment.ALL })
  segment: AudienceSegment;

  /**
   * Set when this notification is for one delegate rather than a segment -
   * "someone added you to their network" and the like.
   *
   * Segment stays populated for these (nothing reads it, and the column is not
   * nullable), but delegateId wins: the inbox query matches this row to its one
   * recipient and to nobody else. Null is the normal broadcast case.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  delegateId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  category: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
