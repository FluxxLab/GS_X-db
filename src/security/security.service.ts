import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { EventSeverity, SecurityEvent } from './entities/security-event.entity';

export interface RecordEventInput { 
    type: string;
    description: string;
    actorId?: string | null;
    severity?: EventSeverity;
    metadata?: Record<string, unknown>
}

@Injectable()
export class SecurityService {
    private readonly logger = new Logger(SecurityService.name);

    constructor(
        @InjectRepository(SecurityEvent)
        private readonly events: Repository<SecurityEvent>,
    ){}

    /**
     * Fire and forget by design: an audit failure must never 
     * fail the audited action
     */
    async record(input: RecordEventInput): Promise<void> {
        try{
            await this.events.save(this.events.create({
                type: input.type,
                description: input.description,
                actionId: input.actorId ?? null,
                severity: input.severity ?? EventSeverity.INFO,
                metadata: input.metadata ?? null,
            }));
        } catch (e) {
            this.logger.error(`audit write failed: ${input.type}`, e as Error);
        }
    }

    list(query: {severity?: EventSeverity; before?: string; limit?: number}){
        return this.events.find({
            where:{
                ...(query.severity && {severity: query.severity}),
                ...(query.before && {createdAt: LessThan(new Date(query.before)),})
            },
            order: { createdAt: 'DESC'},
            take: query.limit ?? 50,
        })
    }
}