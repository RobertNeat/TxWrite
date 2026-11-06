import { ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';

/** Shared between main.ts (real server) and test/app.e2e-spec.ts so the e2e suite exercises the same pipes/plugins/hooks production actually runs. */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(fastifyCookie);

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
}
