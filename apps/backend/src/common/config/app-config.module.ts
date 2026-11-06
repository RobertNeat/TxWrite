import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';

// Resolved relative to this compiled file's own location (dist/common/config),
// not process.cwd() — so a single repo-root .env is found the same way whether
// the backend is started from the repo root, from apps/backend (pnpm --filter
// backend start:dev), or from /app in the Docker image. See .env.example at
// the repo root; apps/backend has no .env of its own anymore.
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(REPO_ROOT, '.env'), join(REPO_ROOT, '.env.local')],
    }),
  ],
})
export class AppConfigModule {}
