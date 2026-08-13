import { Module } from "@nestjs/common";
import { VotingGateway } from "./voting.gateway";
import { TypeOrmModule } from "@nestjs/typeorm";
import {VotingService} from "./voting.service";
import {PitchEntry} from "./entities/pitch-entry.entity";
import {PitchVote} from "./entities/pitch-vote.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([PitchEntry,PitchVote])
    ],
    providers: [VotingGateway, VotingService],
    exports: [VotingService]
})
export class VotingModule {}