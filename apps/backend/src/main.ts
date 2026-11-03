import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

const FILE_BODY_LIMIT_BYTES = 50 * 1024 * 1024;

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: FILE_BODY_LIMIT_BYTES }),
  );
  app.setGlobalPrefix('api');

  const fastify = app.getHttpAdapter().getInstance();

  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, payload, done) => done(null, payload),
  );

  // ServeStaticModule's SPA fallback (app.module.ts) registers a catch-all
  // GET route for index.html so client-side routes like /projects/:id
  // survive a refresh. Without this hook, an unmatched /api/* path (a typo
  // or a removed endpoint) would fall through to that same catch-all and
  // get a 200 HTML response instead of a 404. preHandler (not onRequest)
  // is required: routeOptions is only populated once Fastify has matched
  // the route, which happens after onRequest fires.
  fastify.addHook('preHandler', (request, reply, done) => {
    if (request.url.startsWith('/api/') && request.routeOptions?.url === '*') {
      reply.status(404).send({ statusCode: 404, message: 'Not Found' });
      return;
    }
    done();
  });

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
}
await bootstrap();
