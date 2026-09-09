import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { RedisIoAdapter } from './common/realtime/redis-io.adapter';
// default import: the package is CommonJS and `import * as` gives the
// module namespace, which is not callable under this tsconfig
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  app.useWebSocketAdapter(
    new RedisIoAdapter(
      app,
      config.getOrThrow<string>('REDIS_HOST'),
      config.getOrThrow<number>('REDIS_PORT'),
    ),
  );

  /**
   * Gzip every response.
   *
   * The programme alone is 111 KB of JSON and compresses to 20 KB. At the
   * summit venue the wifi measured around 0.55 Mbps, where that difference is
   * a second and a half per fetch, per delegate, on the one request every
   * screen depends on. Nothing here is large enough for compression to cost
   * more CPU than it saves.
   */
  app.use(compression());

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('GS-26 Summit API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
