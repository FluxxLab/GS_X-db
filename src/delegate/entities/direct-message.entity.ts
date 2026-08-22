import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('direct_messages')
@Index('idx_dm_pair', ['pairKey', 'createdAt'])
@Index('idx_dm_sender', ['senderId'])
@Index('idx_dm_recipient', ['recipientId'])
export class DirectMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 74 })
  pairKey: string;

  @Column()
  senderId: string;

  @Column()
  recipientId: string;

  @Column({ type: 'text' })
  body: string;

  /**
   * The message this one replies to, if any.
   *
   * Nullable and ON DELETE SET NULL rather than CASCADE: deleting a message
   * must not take every reply to it with it. A reply whose parent is gone
   * renders as an ordinary message, which is the honest outcome.
   */
  @Column({ type: 'uuid', nullable: true })
  replyToId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
