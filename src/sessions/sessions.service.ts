import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreateSessionDto } from './dto/create-session.dto';
import { QuerySessionsDto } from './dto/query-sessions.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionBookmark } from './entities/bookmark.entity';
import { SessionAttendance } from './entities/attendance.entity';
import { Session, SessionStatus } from './entities/session.entity';
import { Speaker } from './entities/speaker.entity';
import { RealtimeService, Rooms } from 'src/common/realtime/realtime.service';
@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessions: Repository<Session>,

    @InjectRepository(Speaker)
    private readonly speakers: Repository<Speaker>,

    @InjectRepository(SessionBookmark)
    private readonly bookmarks: Repository<SessionBookmark>,

    @InjectRepository(SessionAttendance)
    private readonly attendance: Repository<SessionAttendance>,

    private readonly realtime: RealtimeService,
  ) {}

  list(query: QuerySessionsDto) {
    return this.sessions.find({
      where: {
        ...(query.day !== undefined && { day: query.day }),
        ...(query.track !== undefined && { track: query.track }),
      },
      relations: {
        speakers: true,
      },
      order: {
        startsAt: 'ASC',
      },
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

  findLiveInRoom(room: string): Promise<Session | null> {
    return this.sessions.findOne({
      where: { room, status: SessionStatus.LIVE },
    });
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
    const { speakerIds, startsAt, endsAt, ...data } = dto;
    Object.assign(session, data);

    if (startsAt) session.startsAt = new Date(startsAt);
    if (endsAt) session.endsAt = new Date(endsAt);

    // was silently discarded: an edit returned 200 and changed nothing
    if (speakerIds) {
      session.speakers = speakerIds.length
        ? await this.speakers.findBy({ id: In(speakerIds) })
        : [];
    }

    return this.sessions.save(session);
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

  async bookmark(delegateId: string, sessionId: string): Promise<void> {
    await this.findById(sessionId); // 404s before the insert if the session is unknown
    await this.bookmarks
      .createQueryBuilder()
      .insert()
      .values({ delegateId, sessionId })
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

  searchSessions(q: string, limit: number = 10): Promise<Session[]> {
    return this.sessions
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.speakers', 'sp') // ← missing line; creates the `sp` alias
      .where('s.title ILIKE :q OR s.description ILIKE :q OR sp.role ILIKE :q', {
        q: `%${q}%`,
      })
      .take(limit)
      .getMany();
  }

  searchSpeakers(q: string, limit: number): Promise<Speaker[]> {
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

  listSpeakers(): Promise<Speaker[]> {
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
