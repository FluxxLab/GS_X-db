import { IsString } from 'class-validator';

export class VerifyPassDto {
  @IsString()
  pass: string;
}
