import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('session_comments')
@Index('idx_comments_session_created', ['sessionId', 'createdAt'])
export class SessionComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sessionId: string;

  @Column({ type: 'uuid' })
  authorId: string;

  @Column({ type: 'varchar', length: 2000 })
  body: string;

  @Column({ type: 'boolean', default: false })
  flagged: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  hiddenAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  hiddenBy: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
