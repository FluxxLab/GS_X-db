import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { REDIS } from '../common/redis/redis.module';
import { CreateSessionDto } from './dto/create-session.dto';
import { QuerySessionsDto } from './dto/query-sessions.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionBookmark } from './entities/bookmark.entity';
import { SessionAttendance } from './entities/attendance.entity';
import {
  Session,
  SessionStatus,
  SessionTrack,
  TRACK_LABELS,
} from './entities/session.entity';
import { Speaker } from './entities/speaker.entity';
import { SessionComment } from '../discussions/entities/session-comment.entity';
import { TranscriptSegment } from '../captions/entities/transcript-segment.entity';
import { RealtimeService, Rooms } from 'src/common/realtime/realtime.service';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(Session)
    private readonly sessions: Repository<Session>,

    @InjectRepository(Speaker)
    private readonly speakers: Repository<Speaker>,

    @InjectRepository(SessionBookmark)
    private readonly bookmarks: Repository<SessionBookmark>,

    @InjectRepository(SessionAttendance)
    private readonly attendance: Repository<SessionAttendance>,

    @InjectRepository(SessionComment)
    private readonly comments: Repository<SessionComment>,

    @InjectRepository(TranscriptSegment)
    private readonly transcripts: Repository<TranscriptSegment>,

    private readonly realtime: RealtimeService,

    @Inject(REDIS)
    private readonly redis: Redis,
  ) {}

  /* --------------------------------------------- speaker reveal (FR-02/03) */

  /**
   * One global switch, off until the organisers throw it: while it is off no
   * delegate surface gives up a speaker's name, role, organisation or photo.
   *
   * Redis rather than a column because it is operational state, not program
   * data - it survives a restart, is shared across API instances, and flipping
   * it is a one-key write on the day rather than a migration.
   */
  private static readonly REVEAL_KEY = 'summit:speakers:revealed';

  /** What a delegate sees in a speaker's place before the reveal. */
  static readonly HIDDEN_SPEAKER_NAME = 'To be announced';

  async speakersRevealed(): Promise<boolean> {
    return (await this.redis.get(SessionsService.REVEAL_KEY)) === '1';
  }

  async setSpeakersRevealed(revealed: boolean): Promise<{ revealed: boolean }> {
    await this.redis.set(SessionsService.REVEAL_KEY, revealed ? '1' : '0');
    // Global, not per-session: the flag is the whole program's, and a delegate
    // sitting on any screen should see the line-up appear without relaunching.
    this.realtime.emitGlobal('speakers:revealed', { revealed });
    return { revealed };
  }

  /**
   * True when this caller must not be shown speaker identities. Admin is
   * exempt - they are the ones building the line-up.
   */
  private async mustHideSpeakers(isAdmin: boolean): Promise<boolean> {
    if (isAdmin) return false;
    return !(await this.speakersRevealed());
  }

  /**
   * The single placeholder a session's whole line-up collapses into.
   *
   * One entry, never one per speaker: redacting each speaker in place would
   * still publish how many there are, and "four speakers, all to be announced"
   * on a panel is a fact about the line-up we are meant to be withholding. The
   * id is a sentinel rather than a real speaker's - there is no row behind it.
   */
  static readonly HIDDEN_SPEAKER_ID = 'tba';

  hiddenSpeaker(): Speaker {
    return {
      id: SessionsService.HIDDEN_SPEAKER_ID,
      name: SessionsService.HIDDEN_SPEAKER_NAME,
      role: null,
      organisation: null,
      avatarUrl: null,
    };
  }

  /**
   * True when this caller must not be shown speaker identities.
   *
   * Redaction itself is not done here any more - SpeakerRevealInterceptor
   * applies it to every HTTP response, so a new endpoint is covered without
   * anyone remembering to call anything. This stays for the two decisions the
   * interceptor cannot make: whether a speaker-only listing returns rows at
   * all, and whether a query may match on speaker columns.
   */
  async mustHideSpeakersFor(isAdmin: boolean): Promise<boolean> {
    return this.mustHideSpeakers(isAdmin);
  }

  /**
   * Derived from the enum rather than written out again, so this can never
   * disagree with what the column accepts. Labels are here too: every client
   * was otherwise inventing its own capitalisation of the same seven values.
   */
  tracks(): { value: SessionTrack; label: string }[] {
    return Object.values(SessionTrack).map((value) => ({
      value,
      label: TRACK_LABELS[value],
    }));
  }

  list(query: QuerySessionsDto) {
    return this.sessions.find({
      where: {
        ...(query.day !== undefined && { day: query.day }),
        ...(query.track !== undefined && { track: query.track }),
        ...(query.status !== undefined && { status: query.status }),
      },
      relations: { speakers: true },
      order: { startsAt: 'ASC' },
    });
  }

  findLiveNow(): Promise<Session[]> {
    /**
     * Functional requirment 1  "live" is Operation-set status,
     * not clock math
     */
    return this.sessions.find({
      where: {
        status: SessionStatus.LIVE,
      },
      relations: {
        speakers: true,
      },
    });
  }

  /**
   * The venue board: what every room is doing, for a public screen.
   *
   * Public and unauthenticated, so it carries only what a departures board
   * needs - title, room, times, status, and the line-up. Speaker names go
   * through SpeakerRevealInterceptor like every other response, so before the
   * reveal a screen shows "To be announced" and not the withheld line-up.
   *
   * Everything comes back rather than "today": the screen decides what is
   * live, next and later from the clock, and the operator-set status, and a
   * day boundary in Abuja is not one the server should be guessing at.
   */
  board(): Promise<Session[]> {
    return this.sessions.find({
      select: {
        id: true,
        title: true,
        day: true,
        startsAt: true,
        endsAt: true,
        room: true,
        track: true,
        type: true,
        status: true,
        speakers: { id: true, name: true, role: true, organisation: true },
      },
      relations: { speakers: true },
      order: { startsAt: 'ASC' },
    });
  }

  findLiveInRoom(room: string): Promise<Session | null> {
    /**
     * Matched loosely on purpose. The capture page sends whichever room string
     * the operator picked, and an exact match means one stray space or a
     * different capitalisation silently drops every caption for the session,
     * with no error raised anywhere to explain it.
     */
    return this.sessions
      .createQueryBuilder('s')
      .where('LOWER(TRIM(s.room)) = LOWER(TRIM(:room))', { room })
      .andWhere('s.status = :status', { status: SessionStatus.LIVE })
      .getOne();
  }

  /**
   * Bulk lookup for surfaces that render many sessions' titles at once, such
   * as cross-session comment moderation. One query instead of one per row.
   */
  findByIds(ids: string[]): Promise<Session[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.sessions.find({ where: { id: In(ids) } });
  }

  async findById(id: string): Promise<Session> {
    const session = await this.sessions.findOne({
      where: {
        id,
      },
      relations: { speakers: true },
    });

    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async create(dto: CreateSessionDto): Promise<Session> {
    const { speakerIds, ...data } = dto;
    const session = this.sessions.create({
      ...data,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
      speakers: speakerIds?.length
        ? await this.speakers.findBy({
            id: In(speakerIds),
          })
        : [],
    });
    return this.sessions.save(session);
  }

  async createBulk(dtos: CreateSessionDto[]): Promise<Session[]> {
    return Promise.all(dtos.map((dto) => this.create(dto)));
  }

  async update(id: string, dto: UpdateSessionDto): Promise<Session> {
    const session = await this.findById(id);
    const { speakerIds, startsAt, endsAt, status, shiftFollowing, ...data } =
      dto;
    Object.assign(session, data);

    if (startsAt) session.startsAt = new Date(startsAt);
    if (endsAt) session.endsAt = new Date(endsAt);
    if (speakerIds) {
      session.speakers = speakerIds.length
        ? await this.speakers.findBy({ id: In(speakerIds) })
        : [];
    }

    // Anything that changes where or when this session sits has to leave
    // the room's timeline free of overlaps. Planned before the write so a
    // refused edit leaves nothing half-applied.
    const placed =
      startsAt !== undefined ||
      endsAt !== undefined ||
      data.room !== undefined ||
      data.day !== undefined;
    const { pushed, deltaMs } = placed
      ? await this.clearRoom(session, Boolean(shiftFollowing))
      : { pushed: [], deltaMs: 0 };

    const saved = await this.sessions.save(session);

    if (pushed.length > 0) {
      await this.sessions.save(pushed);
      // Every client showing a schedule needs to refetch: the delegate app's
      // agenda, the venue board, and any other console tab.
      this.realtime.emitGlobal('sessions:shifted', {
        room: saved.room,
        day: saved.day,
        deltaMinutes: Math.round(deltaMs / 60_000),
        sessionIds: [saved.id, ...pushed.map((s) => s.id)],
      });
      this.logger.log(
        `${saved.room}: pushed ${pushed.length} session(s) after "${saved.title}" to clear an overlap`,
      );
    }

    // status is a transition, not a field write — reuse the one path
    // that emits to the room and trips the audit interceptor
    return status && status !== session.status
      ? this.setStatus(id, status)
      : saved;
  }

  /**
   * One room holds one session at a time. Given a session with its new
   * times already applied, work out what the rest of that room and day has
   * to do about it.
   *
   * Sessions after it are walked in start order, each one pushed just far
   * enough to start when the one before it ends - and no further, so a gap
   * the programme left is kept unless the delay needs it. The push cascades:
   * a session moved into the next one moves that one too. Durations are
   * never changed. Completed sessions are left alone - they already
   * happened. Room is matched loosely, the way the capture page does, so a
   * stray space in a room name cannot split a room into two timelines.
   *
   * Without `push` a collision is refused (409) naming the session in the
   * way, so a single wrong time cannot silently drag the rest of the day.
   * A collision with an *earlier* session is always refused: the edited
   * session is what the operator just typed, and the one before it cannot
   * be moved later without landing on top of it.
   *
   * Returns the sessions that moved, with their new times set but not yet
   * saved, so the caller can write them in the same breath as the edit, and
   * the largest push applied, for the log and the shifted event.
   */
  private async clearRoom(
    edited: Session,
    push: boolean,
  ): Promise<{ pushed: Session[]; deltaMs: number }> {
    const others = await this.sessions
      .createQueryBuilder('s')
      .where('LOWER(TRIM(s.room)) = LOWER(TRIM(:room))', { room: edited.room })
      .andWhere('s.day = :day', { day: edited.day })
      .andWhere('s.id <> :id', { id: edited.id })
      .andWhere('s.status <> :done', { done: SessionStatus.COMPLETED })
      .orderBy('s."startsAt"', 'ASC')
      .getMany();

    const start = edited.startsAt.getTime();
    const hhmm = (d: Date) =>
      d.toLocaleTimeString('en-GB', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
      });

    const before = others.find(
      (s) => s.startsAt.getTime() < start && s.endsAt.getTime() > start,
    );
    if (before) {
      throw new ConflictException(
        `"${edited.title}" would start before "${before.title}" ends at ${hhmm(before.endsAt)} in ${edited.room}. Move that session first.`,
      );
    }

    const pushed: Session[] = [];
    let deltaMs = 0;
    let prevEnd = edited.endsAt.getTime();
    for (const s of others.filter((o) => o.startsAt.getTime() >= start)) {
      if (s.startsAt.getTime() < prevEnd) {
        if (!push) {
          throw new ConflictException(
            `"${edited.title}" would overlap "${s.title}" (${hhmm(s.startsAt)}–${hhmm(s.endsAt)}) in ${edited.room}. Shorten it, or shift the sessions that follow.`,
          );
        }
        const delta = prevEnd - s.startsAt.getTime();
        s.startsAt = new Date(s.startsAt.getTime() + delta);
        s.endsAt = new Date(s.endsAt.getTime() + delta);
        pushed.push(s);
        deltaMs = Math.max(deltaMs, delta);
      }
      prevEnd = s.endsAt.getTime();
    }
    return { pushed, deltaMs };
  }

  async setStatus(id: string, status: SessionStatus): Promise<Session> {
    const session = await this.findById(id);
    session.status = status;

    const saved = await this.sessions.save(session);
    this.realtime.emitToRoom(Rooms.session(id), 'session:status', {
      sessionId: id,
      status,
      at: new Date().toISOString(),
    });

    this.realtime.emitGlobal('session:status', {
      sessionId: id,
      status,
      at: new Date().toISOString(),
    });

    return saved;
  }

  /**
   * Delete a session and everything hanging off it.
   *
   * Only `session_speakers` has a foreign key back to sessions (ON DELETE
   * CASCADE); bookmarks, attendance, comments and transcript segments all
   * carry a plain sessionId column, so they have to be cleared here or they
   * become orphans that still count towards certificates and still surface in
   * delegates' saved lists.
   *
   * Anything a delegate actually did - attended, commented - and the session's
   * transcript are real records, so removing a session that has them needs
   * `force`. The refusal names what would be destroyed rather than making the
   * organiser guess.
   */
  async remove(id: string, force = false): Promise<void> {
    const session = await this.findById(id); // 404s if it is already gone

    const [attendance, comments, transcripts, bookmarks] = await Promise.all([
      this.attendance.countBy({ sessionId: id }),
      this.comments.countBy({ sessionId: id }),
      this.transcripts.countBy({ sessionId: id }),
      this.bookmarks.countBy({ sessionId: id }),
    ]);

    if (!force && (attendance || comments || transcripts)) {
      const parts = [
        attendance && `${attendance} attendance record(s)`,
        comments && `${comments} comment(s)`,
        transcripts && `${transcripts} caption line(s)`,
        bookmarks && `${bookmarks} bookmark(s)`,
      ].filter(Boolean);
      throw new ConflictException(
        `"${session.title}" has ${parts.join(', ')}. Deleting removes them permanently.`,
      );
    }

    await this.bookmarks.delete({ sessionId: id });
    await this.attendance.delete({ sessionId: id });
    await this.comments.delete({ sessionId: id });
    await this.transcripts.delete({ sessionId: id });
    await this.sessions.delete({ id });

    // global, not the session room: a delegate looking at the programme is not
    // in that room, and their agenda has to lose the session too
    this.realtime.emitGlobal('session:deleted', { sessionId: id });
  }

  async bookmark(delegateId: string, sessionId: string): Promise<void> {
    await this.findById(sessionId); // 404s before the insert if the session is unknown
    await this.bookmarks
      .createQueryBuilder()
      .insert()
      // createdAt set explicitly: a query-builder insert bypasses entity
      // hooks, and the column was created NOT NULL without a default
      .values({ delegateId, sessionId, createdAt: new Date() })
      .orIgnore()
      .execute();
  }

  async unbookmark(delegateId: string, sessionId: string): Promise<void> {
    await this.bookmarks.delete({ delegateId, sessionId });
  }

  async savedSessions(delegateId: string): Promise<Session[]> {
    const rows = await this.bookmarks.find({
      where: { delegateId },
    });
    if (!rows.length) return [];
    return this.sessions.find({
      where: { id: In(rows.map((r) => r.sessionId)) },
      relations: { speakers: true },
      order: { startsAt: 'ASC' },
    });
  }

  async searchSessions(
    q: string,
    limit: number = 10,
    isAdmin = false,
  ): Promise<Session[]> {
    const hide = await this.mustHideSpeakers(isAdmin);
    const rows = await this.sessions
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.speakers', 'sp') // ← missing line; creates the `sp` alias
      // While speakers are hidden the speaker columns drop out of the WHERE
      // too: matching a session on its speaker's role would let a delegate
      // find out who is on it by guessing, which is the thing being withheld.
      .where(
        hide
          ? 's.title ILIKE :q OR s.description ILIKE :q'
          : 's.title ILIKE :q OR s.description ILIKE :q OR sp.role ILIKE :q',
        { q: `%${q}%` },
      )
      .take(limit)
      .getMany();
    // The joined speakers are redacted by SpeakerRevealInterceptor on the way
    // out; what has to happen here is the WHERE, which it cannot reach.
    return rows;
  }

  /**
   * Before the reveal this returns nothing at all rather than placeholders:
   * the query itself is the leak. Searching a name and getting one "To be
   * announced" back confirms that person is speaking.
   */
  async searchSpeakers(
    q: string,
    limit: number,
    isAdmin = false,
  ): Promise<Speaker[]> {
    if (await this.mustHideSpeakers(isAdmin)) return [];
    return this.speakers
      .createQueryBuilder('s')
      .where('s.name ILIKE :q OR s.organisation ILIKE :q OR s.role ILIKE :q', {
        q: `%${q}%`,
      })
      .take(limit)
      .getMany();
  }

  async statusCounts() {
    const [live, scheduled, completed] = await Promise.all([
      this.sessions.countBy({ status: SessionStatus.LIVE }),
      this.sessions.countBy({ status: SessionStatus.SCHEDULED }),
      this.sessions.countBy({ status: SessionStatus.COMPLETED }),
    ]);
    return { live, scheduled, completed };
  }

  /** Empty for delegates before the reveal - see searchSpeakers. */
  async listSpeakers(isAdmin = false): Promise<Speaker[]> {
    if (await this.mustHideSpeakers(isAdmin)) return [];
    return this.speakers.find({ order: { name: 'ASC' } });
  }

  createSpeaker(dto: Partial<Speaker>): Promise<Speaker> {
    return this.speakers.save(this.speakers.create(dto));
  }

  // Attendance is only recorded while a session is LIVE: opening the page for a
  // scheduled or finished session is browsing, not participation. Idempotent -
  // the unique (delegateId, sessionId) index makes a repeat join a no-op.
  async recordAttendance(delegateId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.findOneBy({ id: sessionId });
    if (!session || session.status !== SessionStatus.LIVE) return;

    await this.attendance
      .createQueryBuilder()
      .insert()
      .into(SessionAttendance)
      .values({ delegateId, sessionId })
      .orIgnore()
      .execute();
  }

  hasAttended(delegateId: string): Promise<boolean> {
    return this.attendance.existsBy({ delegateId });
  }
}
