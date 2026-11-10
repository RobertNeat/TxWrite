import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp } from './app-setup.js';

const FILE_BODY_LIMIT_BYTES = 50 * 1024 * 1024;

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: FILE_BODY_LIMIT_BYTES }),
  );
  await configureApp(app);

  const port = Number(process.env.PORT ?? 10800);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
}
await bootstrap();
