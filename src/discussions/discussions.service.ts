import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import {
  HiddenFilter,
  QueryAllCommentsDto,
} from './dto/query-all-comments.dto';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { QueryCommentsDto } from './dto/query-comments.dto';
import { SessionComment } from './entities/session-comment.entity';
import { DelegatesService } from '../delegate/delegates.service';
import { SecurityService } from '../security/security.service';

@Injectable()
export class DiscussionService {
  constructor(
    @InjectRepository(SessionComment)
    private readonly comments: Repository<SessionComment>,
    private readonly sessions: SessionsService,
    private readonly realtime: RealtimeService,
    private readonly delegateService: DelegatesService,
    private readonly securityService: SecurityService,
  ) {}

  async postComment(
    sessionId: string,
    authorId: string,
    dto: CreateCommentDto,
  ) {
    /**
     * returns 404 if the session comment  doesnt exist
     */
    await this.sessions.findById(sessionId);

    const comment = await this.comments.save(
      this.comments.create({ sessionId, authorId, body: dto.body }),
    );

    this.realtime.emitToRoom(
      Rooms.discussion(sessionId),
      'discussion:comment',
      {
        id: comment.id,
        sessionId,
        authorId,
        body: comment.body,
        createAt: comment.createdAt,
      },
    );
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

    const authors = await this.delegateService.namesByIds(
      comments.map((c) => c.authorId),
    );
    return comments.map((c) => ({
      ...c,
      authorName: authors.get(c.authorId)?.name ?? 'Delegate',
      authorOrganisation: authors.get(c.authorId)?.organisation ?? null,
    }));
  }

  /**
   * Every thread in one place, for moderation.
   *
   * Deliberately different from listComments, which serves delegates: that one
   * hides hidden comments and is scoped to a session. A moderator works the
   * other way round - across sessions, newest first, with hidden and flagged
   * rows visible, because those are the ones needing a second look.
   */
  async listAllComments(query: QueryAllCommentsDto) {
    const hidden = query.hidden ?? HiddenFilter.INCLUDE;

    const comments = await this.comments.find({
      where: {
        ...(query.sessionId && { sessionId: query.sessionId }),
        ...(query.flagged && { flagged: true }),
        ...(hidden === HiddenFilter.EXCLUDE && { hiddenAt: IsNull() }),
        ...(hidden === HiddenFilter.ONLY && { hiddenAt: Not(IsNull()) }),
        ...(query.before && { createdAt: LessThan(new Date(query.before)) }),
      },
      order: { createdAt: 'DESC' },
      take: query.limit,
    });

    // Two bulk lookups rather than a join per row: a moderation sweep reads
    // hundreds of comments spanning a handful of sessions and authors.
    const [authors, sessionTitles] = await Promise.all([
      this.delegateService.namesByIds(comments.map((c) => c.authorId)),
      this.sessionTitles(comments.map((c) => c.sessionId)),
    ]);

    return comments.map((c) => ({
      ...c,
      authorName: authors.get(c.authorId)?.name ?? 'Delegate',
      authorOrganisation: authors.get(c.authorId)?.organisation ?? null,
      // Without this a cross-session list gives a moderator no idea where a
      // comment came from.
      sessionTitle: sessionTitles.get(c.sessionId) ?? 'Unknown session',
    }));
  }

  private async sessionTitles(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const rows = await this.sessions.findByIds(unique);
    return new Map(rows.map((s) => [s.id, s.title]));
  }

  async flagComment(commentId: string, delegateId: string) {
    const comment = await this.comments.findOneBy({
      id: commentId,
    });

    if (!comment) throw new NotFoundException('Comment not found');

    await this.comments.update(commentId, { flagged: true });

    await this.securityService.record({
      type: 'comment_flagged',
      description: 'Discussion comment reported by a delegate',
      actorId: delegateId,
      metadata: { commentId, sessionId: comment.sessionId },
    });
  }

  async hideComment(commentId: string, adminId: string) {
    const comment = await this.comments.findOneBy({
      id: commentId,
    });

    if (!comment) throw new NotFoundException('Comment not found');

    // hidden comments stay in the database for the audit trail (FR-14)
    await this.comments.update(commentId, {
      hiddenAt: new Date(),
      hiddenBy: adminId,
    });

    this.realtime.emitToRoom(
      Rooms.discussion(comment.sessionId),
      'discussion:hidden',
      {
        commentId,
      },
    );
  }

  /**
   * Admin view: everything, including hidden $ flagged, for modetation
   */
  listForModeration(sessionId: string) {
    return this.comments.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Raw thread for the post session harvest job (BullMQ phase)
   */
  fullThread(sessionId: string) {
    return this.comments.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }
}
