import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum AudienceSegment { 
   ALL = 'all',
  VIP = 'vip',
  PRESS = 'press',
  SPEAKERS = 'speakers',
  VOLUNTEERS = 'volunteers'
}

@Entity('notifications')
export class Notification {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({type: 'varchar', length: 255})
    title: string;


    @Column({type: 'text' })
    body: string;

    @Column({type: 'enum', enum: AudienceSegment, default: AudienceSegment.ALL})
    segment: AudienceSegment;

    @Column({type: 'varchar', length: 255, nullable: true})
    category: string | null;

    @Column({type: 'timestamptz', nullable: true})
    sentAt: Date | null;

    @CreateDateColumn({type: 'timestamptz'})
    createdAt: Date;


}