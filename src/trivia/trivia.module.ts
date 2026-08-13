import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TriviaController } from "./trivia.controller";
import { TriviaGateway } from "./trivia.gateway";
import { TriviaService } from "./trivia.service";
import { TriviaQuestion } from "./entities/trivia-question.entity";
import { TriviaAnswer } from "./entities/trivia-answer.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([TriviaQuestion, TriviaAnswer])
    ],
    controllers: [TriviaController],
    providers: [TriviaGateway, TriviaService]
})
export class TriviaModule {}
