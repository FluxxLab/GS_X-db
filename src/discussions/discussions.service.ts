import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { QueryCommentsDto } from './dto/query-comments.dto';
import { SessionComment } from './entities/session-comment.entity';
import { DelegatesService } from '../delegate/delegates.service';


@Injectable()
export class DiscussionService {
    constructor(
        @InjectRepository(SessionComment)
        private readonly comments: Repository<SessionComment>,
        private readonly sessions: SessionsService,
        private readonly realtime: RealtimeService,
        private readonly delegateService: DelegatesService
    ){}

    async postComment(sessionId: string, authorId: string, dto: CreateCommentDto){
        /**
         * returns 404 if the session comment  doesnt exist
         */
        await this.sessions.findById(sessionId);

        const comment =  await this.comments.save(
            this.comments.create({sessionId, authorId, body: dto.body}),
        );

        this.realtime.emitToRoom(Rooms.discussion(sessionId), 'discussion:comment',{
            id: comment.id,
            sessionId,
            authorId,
            body: comment.body,
            createAt: comment.createdAt,
        });
        return comment;
    }


    async listComments(sessionId: string, query: QueryCommentsDto) {
  const comments = await this.comments.find({
    where: {
      sessionId,
      hiddenAt: IsNull(),
      ...(query.before && { createdAt: LessThan(new Date(query.before)) }),
    },
    order: { createdAt: 'DESC' },
    take: query.limit,
  });

  const authors = await this.delegateService.namesByIds(comments.map((c) => c.authorId));
  return comments.map((c) => ({
    ...c,
    authorName: authors.get(c.authorId)?.name ?? 'Delegate',
    authorOrganisation: authors.get(c.authorId)?.organisation ?? null,
  }));
}



    async flagComment(commentId: string, delegate: string){
        const comment = await this.comments.findOneBy({
            id: commentId
        });

        /**
         * TODO (security): SecurityEvent {type: 'comment_flagged', actor: delegate}
         */
    }

    async hideComment(commentId: string, adminId: string){
        const comment = await this.comments.findOneBy({
            id: commentId
        });
    

    if(!comment) throw new NotFoundException('Comment not found');


    await this.realtime.emitToRoom(Rooms.discussion(comment.sessionId), 'discussion:hidden', {
        commentId,
    });
    }

    /**
     * Admin view: everything, including hidden $ flagged, for modetation
     */
    listForModeration(sessionId: string){
        return this.comments.find({
            where: {sessionId},
            order: {createdAt: 'DESC'},
        });
    }

    /**
     * Raw thread for the post session harvest job (BullMQ phase)
     */
    fullThread(sessionId: string){
       
       return this.comments.find({ where: {sessionId},
        order: {createdAt: 'ASC'},
    });
    }
}