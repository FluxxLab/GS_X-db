import { DelegateModule } from '../delegate/delegate.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SessionComment]),
    SessionsModule,
    DelegateModule,          // ← the missing line
  ],
  ...
})
