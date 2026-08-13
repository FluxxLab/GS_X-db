import { Module} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Delegate } from './entities/delegate.entity';
import { DelegatesService } from './delegates.service';
import {RegistrationEntry} from "./entities/registration-entry.entity";

@Module({
    imports:[TypeOrmModule.forFeature([Delegate, RegistrationEntry])],
    controllers: [],
    providers: [DelegatesService],
    exports: [DelegatesService]
})
export class DelegateModule {}
