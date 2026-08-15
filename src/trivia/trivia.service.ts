import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
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
    this.realtime.emitToRoom(
      Rooms.trivia,
      'trivia:question',
      {
        ...this.toDelegateShape(saved),
        playersCount: Object.values(distribution).reduce((a, b) => a + b, 0),
      },
    );
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
