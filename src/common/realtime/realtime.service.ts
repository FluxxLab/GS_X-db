import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

export const Rooms = {
    session: (id: string) => `session:${id}`,
    caption: (sessionId: string) => `captions:${sessionId}`,
    discussion: (sessionId: string) => `discussion:${sessionId}`,
    voting: 'voting',
    trivia: 'trivia',
    notifications: (segment: string) => `notifications:${segment}`,
} as const;



@Injectable()
export class RealtimeService {
    private readonly logger = new Logger(RealtimeService.name);
    private server: Server | null = null;

    /**
     * Called once by the gateway in afterinit
     */
    bindServer(server: Server): void {
        this.server = server;
    }

    emitToRoom(room: string, event: string, payload: unknown): void{

        if(!this.server){
            this.logger.warn(`emit before gateway init: ${event} ->${room}`);
            return;
        }

        /**
         * Redis adapter propagates this to every API instance ()
         */
        this.server.to(room).emit(event,payload);
    }

    /**
     * Broadcast to every connected client, all instances(cut-to-break, overlay toggles)
     */
    emitGlobal(event: string, payload: unknown): void{
        if(!this.server){
            this.logger.warn(`emit before gateware init: ${event} (global)`);
            return;
        }
        this.server.emit(event, payload);
    }

    /**
     * How many sockets are in a room , across all instance(viewers counts)
     */
    async roomSize(room: string): Promise<number>{
        if(!this.server) return 0;

        return (await this.server.in(room).fetchSockets()).length;
        
    }

}