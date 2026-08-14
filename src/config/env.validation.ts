import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
}

export class EnvironmentVariables {
  @IsEnum(Environment) NODE_ENV: Environment;
  @IsInt() @Min(1) @Max(65535) PORT: number;

  @IsString() DB_HOST: string;
  @IsInt() @Min(1) @Max(65535) DB_PORT: number;
  @IsString() DB_USER: string;
  @IsString() DB_PASSWORD: string;
  @IsString() DB_NAME: string;

  @IsString() JWT_SECRET: string;
  @IsInt() JWT_ACCESS_TTL: number;
  @IsInt() JWT_REFRESH_TTL: number;
  @IsString() REDIS_HOST: string;
  @IsOptional() @IsString() SMTP_HOST?: string;
  @IsOptional() @IsInt() SMTP_PORT?: number;
  @IsOptional() @IsString() SMTP_USER?: string;
  @IsOptional() @IsString() SMTP_PASSWORD?: string;
  @IsOptional() @IsString() SMTP_FROM?: string;
  @IsOptional() @IsString() TERMII_API_KEY?: string;
  @IsOptional() @IsString() TERMII_SENDER_ID?: string;

  @IsInt() @Min(1) @Max(65535) REDIS_PORT: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) throw new Error(errors.toString());

  return validated;
}
