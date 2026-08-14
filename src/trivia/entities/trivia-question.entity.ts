import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TriviaOption {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
}

export enum TriviaStatus {
  DRAFT = 'draft',
  LIVE = 'live',
  CLOSED = 'closed',
}

@Entity('trivia_questions')
@Index('idx_trivia_status', ['status'])
export class TriviaQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 500 })
  optionA: string;

  @Column({ type: 'varchar', length: 500 })
  optionB: string;

  @Column({ type: 'varchar', length: 500 })
  optionC: string;

  @Column({ type: 'varchar', length: 500 })
  optionD: string;

  @Column({ type: 'enum', enum: TriviaOption })
  correctOption: TriviaOption;

  @Column({ type: 'text', nullable: true })
  explanation: string;

  @Column({ type: 'enum', enum: TriviaStatus, default: TriviaStatus.DRAFT })
  status: TriviaStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
