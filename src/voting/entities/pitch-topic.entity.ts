import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
} from 'typeorm';

export enum TopicVoting {

    PENDING = 'pending',
    OPEN = 'open',
    CLOSED = 'closed',
}


export interface TopicTally {
    topicId: string;
    counts: Array<{ entryId: string; votes: number }>;
    /** Ballots cast. One per delegate, so this is also the voter count. */
    voters: number;
}

@Entity('pitch_topics')
export class PitchTopic {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 160 })
    name: string;

    /** Presentation order in the run-of-show. */
    @Column({ type: 'int', default: 0 })
    position: number;

    @Column({ type: 'enum', enum: TopicVoting, default: TopicVoting.PENDING })
    voting: TopicVoting;

    /** The tally as it stood the instant voting closed - the announced result.
     *  Null until then; never recomputed. */
    @Column({ type: 'jsonb', nullable: true })
    result: TopicTally | null;

    @Column({ type: 'timestamptz', nullable: true })
    closedAt: Date | null;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;
}
