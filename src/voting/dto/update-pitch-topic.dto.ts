import { PartialType } from '@nestjs/swagger';
import { CreatePitchTopicDto } from './create-pitch-topic.dto';

export class UpdatePitchTopicDto extends PartialType(CreatePitchTopicDto) {}
