import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TriviaOption } from './trivia-question.entity';

@Entity('trivia_answers')
@Unique('uq_answer_delegate_question', ['delegateId', 'questionId'])
export class TriviaAnswer {
    
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({type: 'uuid'})
    delegateId: string;

    @Column({type: 'uuid'})
    questionId: string;

    @Column({type: 'enum', enum: TriviaOption})
    chosenOption: TriviaOption;

    @CreateDateColumn({type: 'timestamptz'})
    createdAt: Date;
}