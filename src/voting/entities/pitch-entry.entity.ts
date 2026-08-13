import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SessionTrack } from '../../sessions/entities/session.entity';


@Entity('pitch_entries')
export class PitchEntry {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({type: 'varchar', length: 255})
    innovatorName: string;

    @Column({type: 'varchar', length: 100})
    country: string;

    @Column({type: 'enum', enum: SessionTrack})
    track: SessionTrack;

    @Column({type:'text'})
    description: string;

    @CreateDateColumn({type:'timestamptz'})
    createdAt: Date;

    @UpdateDateColumn({type:'timestamptz'})
    updatedAt: Date;
}