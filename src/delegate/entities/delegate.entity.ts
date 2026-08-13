import{
    Entity,
    CreateDateColumn,
    UpdateDateColumn,
    PrimaryGeneratedColumn,
    Column,

} from "typeorm";

export enum AccessTier{
    STANDARD= 'standard',
    VIP=  'vip',
    VVIP = 'vvip',
    PRESS = 'press',
    ADMIN = 'admin'
}

@Entity("delegates")
export class Delegate{

    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({length: 255, unique: true, type: "varchar"})
    email: string;

    @Column({length: 255,  type: "varchar", select: false})
    passwordHash: string;

    @Column({ length: 255})
    name: string;

   

    @Column({ type: "enum", enum: AccessTier, default: AccessTier.STANDARD})
    accessTier: AccessTier;

   @Column({ type: "varchar", length: 100, nullable: true })
title: string | null;

@Column({ type: "varchar", length: 100, nullable: true })
track: string | null;

@Column({ type: "varchar", length: 255, nullable: true })
organisation: string | null;

@Column({ type: "varchar", length: 100, nullable: true })
country: string | null;

    
    @Column({ default: false})
    flagged: boolean;

    @CreateDateColumn({ type: "timestamptz"})
    createdAt: Date;

    @Column({type: 'text', array: true, default:'{}'})
    tags: string[]; 

    @Column({type: 'boolean', default: false})
    pendingReview: boolean;

    @Column({type: 'varchar', length: 20, nullable: true})
    phone: string | null;

    @Column({type: "text", array: true, default: "{}"})
    tracks: string[];

    @Column({type: "text", array: true, default: "{}"})
    interests: string[];

    @Column({type: "timestamptz", nullable: true})
    consentAt: Date | null;
}
