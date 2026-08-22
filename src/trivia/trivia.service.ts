import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { REDIS } from '../common/redis/redis.module';
import { AnswerTriviaDto } from './dto/answer-trivia.dto';
import { CreateTriviaQuestionDto } from './dto/create-trivia.dto';
import { TriviaAnswer } from './entities/trivia-answer.entity';
import {
  TriviaOption,
  TriviaQuestion,
  TriviaStatus,
} from './entities/trivia-question.entity';

const disKey = (questionId: string) => `trivia:dist:${questionId}`;

export interface DelegateQuestion {
  id: string;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  playersCount: number;
}

export interface DelegateHistoryEntry {
  id: string;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  chosenOption: TriviaOption | null; // null when the delegate never answered
  correctOption: TriviaOption;
  explanation: string | null;
  correct: boolean | null; // null when unanswered - not the same as wrong
  distribution: Record<TriviaOption, number>;
  playersCount: number;
}

@Injectable()
export class TriviaService {
  constructor(
    @InjectRepository(TriviaQuestion)
    private readonly questions: Repository<TriviaQuestion>,
    @InjectRepository(TriviaAnswer)
    private readonly answers: Repository<TriviaAnswer>,
    @Inject(REDIS)
    private readonly redis: Redis,
    private readonly realtime: RealtimeService,
  ) {}

  /***
   * delegate facing
   */
  async currentQuestion(): Promise<DelegateQuestion | null> {
    const q = await this.questions.findOneBy({
      status: TriviaStatus.LIVE,
    });
    if (!q) return null;
    const shape = this.toDelegateShape(q);
    const distribution = await this.distribution(q.id);
    return {
      ...shape,
      playersCount: Object.values(distribution).reduce((a, b) => a + b, 0),
    };
  }

  /**
   * A delegate's own trivia history: every closed question, with what they
   * answered and what was correct.
   *
   * Questions they never answered are included on purpose - the reveal and the
   * explanation are the point, and omitting them would make the list look like
   * it had lost rows. `chosenOption` is null for those.
   *
   * Two bulk reads rather than a query per question: the whole summit is a
   * handful of questions and this renders as one list.
   */
  async historyFor(delegateId: string): Promise<DelegateHistoryEntry[]> {
    const closed = await this.questions.find({
      where: { status: TriviaStatus.CLOSED },
      order: { createdAt: 'DESC' },
    });
    if (closed.length === 0) return [];

    const mine = await this.answers.find({
      where: {
        delegateId,
        questionId: In(closed.map((q) => q.id)),
      },
    });
    const byQuestion = new Map(mine.map((a) => [a.questionId, a.chosenOption]));

    const distributions = await Promise.all(
      closed.map((q) => this.distribution(q.id)),
    );

    return closed.map((q, index) => {
      const chosenOption = byQuestion.get(q.id) ?? null;
      const distribution = distributions[index];
      return {
        id: q.id,
        text: q.text,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        chosenOption,
        correctOption: q.correctOption,
        explanation: q.explanation ?? null,
        // null (unanswered) is not the same as wrong, so it stays null
        correct:
          chosenOption === null ? null : chosenOption === q.correctOption,
        distribution,
        playersCount: Object.values(distribution).reduce((a, b) => a + b, 0),
      };
    });
  }

  async answer(delegateId: string, questionId: string, dto: AnswerTriviaDto) {
    const question = await this.questions.findOneBy({
      id: questionId,
    });

    if (!question) throw new NotFoundException('Question not found');
    if (question.status !== TriviaStatus.LIVE) {
      throw new ConflictException('Question is not live');
    }

    const result = await this.answers
      .createQueryBuilder()
      .insert()
      .values({ delegateId, questionId, chosenOption: dto.chosenOption })
      .orIgnore()
      .execute();

    if (result.identifiers.length === 0) {
      throw new ConflictException('Already answered');
    }

    await this.redis.hincrby(disKey(questionId), dto.chosenOption, 1);
    this.realtime.emitToRoom(Rooms.trivia, 'trivia:distribution', {
      questionId,
      distribution: await this.distribution(questionId),
    });

    return {
      correct: dto.chosenOption === question.correctOption,
      correctOption: question.correctOption,
      explanation: question.explanation,
    };
  }

  /**
   * Admin facing
   */
  create(dto: CreateTriviaQuestionDto): Promise<TriviaQuestion> {
    return this.questions.save(this.questions.create(dto));
  }

  listAll(): Promise<TriviaQuestion[]> {
    return this.questions.find({ order: { createdAt: 'DESC' } });
  }

  async pushLive(id: string): Promise<TriviaQuestion> {
    const question = await this.questions.findOneBy({
      id,
    });

    if (!question) throw new NotFoundException('Question not found');

    /**
     * only one live question at a time: clise any current one first
     *
     */
    await this.questions.update(
      { status: TriviaStatus.LIVE },
      { status: TriviaStatus.CLOSED },
    );

    question.status = TriviaStatus.LIVE;
    const saved = await this.questions.save(question);
    const distribution = await this.distribution(saved.id);
    this.realtime.emitToRoom(Rooms.trivia, 'trivia:question', {
      ...this.toDelegateShape(saved),
      playersCount: Object.values(distribution).reduce((a, b) => a + b, 0),
    });
    return saved;
  }

  async close(id: string): Promise<TriviaQuestion> {
    const question = await this.questions.findOneBy({ id });

    if (!question) throw new NotFoundException('Question not found');
    question.status = TriviaStatus.CLOSED;
    const saved = await this.questions.save(question);
    this.realtime.emitToRoom(Rooms.trivia, 'trivia:closed', {
      questionId: id,
      correctOption: saved.correctOption,
      explanation: saved.explanation,
      distribution: await this.distribution(id),
    });
    return saved;
  }

  async stats(id: string) {
    const distribution = await this.distribution(id);
    const playCount = Object.values(distribution).reduce((a, b) => a + b, 0);
    return { questionId: id, playCount, distribution };
  }

  /**
   * Internals
   */
  private async distribution(
    questionId: string,
  ): Promise<Record<TriviaOption, number>> {
    const raw = await this.redis.hgetall(disKey(questionId));
    return {
      [TriviaOption.A]: Number(raw.A ?? 0),
      [TriviaOption.B]: Number(raw.B ?? 0),
      [TriviaOption.C]: Number(raw.C ?? 0),
      [TriviaOption.D]: Number(raw.D ?? 0),
    };
  }

  private toDelegateShape(q: TriviaQuestion): DelegateQuestion {
    const { id, text, optionA, optionB, optionC, optionD } = q;
    return { id, text, optionA, optionB, optionC, optionD, playersCount: 0 };
  }
}
