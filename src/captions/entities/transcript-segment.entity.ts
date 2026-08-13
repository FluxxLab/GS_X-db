import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum TranscriptSource{
    AI = 'ai',
    HUMAN = 'human'
}

@Entity('transcript_segments')
export class TranscriptSegment {

    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({type: 'varchar', length: 255})
    sessionId: string;

    @Column({type: 'text'})
    text: string;

    @Column({type: 'varchar', length: 255})
    room: string;

    @Column({type: 'enum', enum: TranscriptSource, default: TranscriptSource.AI})
    source: TranscriptSource;

    @CreateDateColumn({type: 'timestamptz'})
    createdAt: Date;
}
