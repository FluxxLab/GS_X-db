import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import {
  HiddenFilter,
  QueryAllCommentsDto,
} from './dto/query-all-comments.dto';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { QueryCommentsDto } from './dto/query-comments.dto';
import { SessionComment } from './entities/session-comment.entity';
import { CommentVote, VoteValue } from './entities/comment-vote.entity';
import { DelegatesService } from '../delegate/delegates.service';
import { SecurityService } from '../security/security.service';

@Injectable()
export class DiscussionService {
  constructor(
    @InjectRepository(SessionComment)
    private readonly comments: Repository<SessionComment>,
    @InjectRepository(CommentVote)
    private readonly votes: Repository<CommentVote>,
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

  async listComments(
    sessionId: string,
    query: QueryCommentsDto,
    viewerId?: string,
  ) {
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

    /**
     * One bulk lookup for the viewer's own votes rather than a per-row query:
     * the client needs to render its buttons in the voted state, and a thread
     * is read all at once.
     */
    const myVotes = await this.votesByViewer(
      viewerId,
      comments.map((c) => c.id),
    );

    return comments.map((c) => ({
      ...c,
      authorName: authors.get(c.authorId)?.name ?? 'Delegate',
      authorOrganisation: authors.get(c.authorId)?.organisation ?? null,
      myVote: myVotes.get(c.id) ?? null,
    }));
  }

  private async votesByViewer(
    viewerId: string | undefined,
    commentIds: string[],
  ): Promise<Map<string, VoteValue>> {
    if (!viewerId || commentIds.length === 0) return new Map();
    const rows = await this.votes.find({
      where: { delegateId: viewerId, commentId: In(commentIds) },
    });
    return new Map(rows.map((r) => [r.commentId, r.value]));
  }

  /**
   * Casts, changes or clears one delegate's vote on a comment.
   *
   * The counters and the vote row move together in a transaction, and the
   * counters move by SQL increment rather than by writing a value read a moment
   * earlier - two delegates voting at once would otherwise both write the same
   * number and lose one of the votes.
   */
  async vote(commentId: string, delegateId: string, value: VoteValue | null) {
    const comment = await this.comments.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');

    return this.comments.manager.transaction(async (manager) => {
      const votes = manager.getRepository(CommentVote);
      const existing = await votes.findOne({
        where: { commentId, delegateId },
      });
      const previous = existing?.value ?? null;

      if (previous !== value) {
        if (value === null) {
          await votes.delete({ commentId, delegateId });
        } else if (existing) {
          await votes.update({ id: existing.id }, { value });
        } else {
          await votes.insert({ commentId, delegateId, value });
        }

        let likeDelta = 0;
        let dislikeDelta = 0;
        if (previous === VoteValue.LIKE) likeDelta -= 1;
        if (previous === VoteValue.DISLIKE) dislikeDelta -= 1;
        if (value === VoteValue.LIKE) likeDelta += 1;
        if (value === VoteValue.DISLIKE) dislikeDelta += 1;

        if (likeDelta !== 0) {
          await manager.increment(
            SessionComment,
            { id: commentId },
            'likes',
            likeDelta,
          );
        }
        if (dislikeDelta !== 0) {
          await manager.increment(
            SessionComment,
            { id: commentId },
            'dislikes',
            dislikeDelta,
          );
        }
      }

      const updated = await manager.findOneOrFail(SessionComment, {
        where: { id: commentId },
      });
      return {
        id: commentId,
        likes: updated.likes,
        dislikes: updated.dislikes,
        myVote: value,
      };
    });
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

  /**
   * One row per session, whether or not anyone has posted.
   *
   * listAllComments answers "what has been said"; this answers "where can it
   * be said". A thread with no comments is invisible to the former, which
   * makes a freshly created forum look like it failed to exist.
   */
  async listThreads() {
    const sessions = await this.sessions.list({});

    const counts = await this.comments
      .createQueryBuilder('c')
      .select('c.sessionId', 'sessionId')
      .addSelect('COUNT(*)', 'comments')
      .addSelect('COUNT(*) FILTER (WHERE c.flagged)', 'flagged')
      .addSelect('COUNT(*) FILTER (WHERE c."hiddenAt" IS NOT NULL)', 'hidden')
      .addSelect('MAX(c."createdAt")', 'lastAt')
      .groupBy('c.sessionId')
      .getRawMany<{
        sessionId: string;
        comments: string;
        flagged: string;
        hidden: string;
        lastAt: Date | null;
      }>();

    const byId = new Map(counts.map((row) => [row.sessionId, row]));

    return sessions.map((session) => {
      const row = byId.get(session.id);
      return {
        sessionId: session.id,
        title: session.title,
        track: session.track,
        type: session.type,
        room: session.room,
        // Counts arrive as strings from a raw aggregate.
        comments: Number(row?.comments ?? 0),
        flagged: Number(row?.flagged ?? 0),
        hidden: Number(row?.hidden ?? 0),
        lastAt: row?.lastAt ?? null,
      };
    });
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
