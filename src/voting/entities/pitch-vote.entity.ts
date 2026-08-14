import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('pitch_votes')
@Unique('uq_vote_delegate_entry', ['delegateId', 'entryId'])
export class PitchVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  delegateId: string;

  @Column()
  entryId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
