import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { PackageIndexService } from './package-index.service.js';
import { JobQueueService } from '../job-queue/job-queue.service.js';
import { EventBusService } from '../events/event-bus.service.js';

export interface InstallOutcome {
  packageName: string;
  installed: boolean;
  message?: string;
}

const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Resolves a missing file (from a compile log) to the TeX Live package that
 * provides it, and installs that package via tlmgr user mode, serialized and
 * deduplicated through the JobQueueService (architecture.md section 6.2).
 */
@Injectable()
export class ResourceResolverService {
  private readonly logger = new Logger(ResourceResolverService.name);
  private readonly networkFetchEnabled: boolean;

  constructor(
    private readonly packageIndex: PackageIndexService,
    private readonly jobQueue: JobQueueService,
    private readonly eventBus: EventBusService,
    config: ConfigService,
  ) {
    this.networkFetchEnabled =
      config.get<string>('NETWORK_FETCH', 'true') !== 'false';
  }

  /**
   * Resolves and installs the package providing `fileName`. Returns null if no
   * package in the index provides it (nothing to do — likely a genuinely
   * unknown file, or something this app isn't set up to resolve).
   */
  async resolveAndInstall(
    fileName: string,
    projectId?: string,
  ): Promise<InstallOutcome | null> {
    const packageName = this.packageIndex.packageProviding(fileName);
    if (!packageName) {
      return null;
    }

    if (!this.networkFetchEnabled) {
      // architecture.md section 6.7: "No network and package not cached: show
      // 'Package X is not installed and needs a download. Connect to the
      // network and compile again.'"
      return {
        packageName,
        installed: false,
        message: `Package ${packageName} is not installed and needs a download. Connect to the network and compile again.`,
      };
    }

    if (!PACKAGE_NAME_PATTERN.test(packageName)) {
      // Defensive: the index is built from a trusted baked-in tlpdb, so this
      // should never trigger, but a package name is about to reach a spawned
      // command line and must never be trusted blindly.
      return {
        packageName,
        installed: false,
        message: 'Rejected: package name failed validation',
      };
    }

    this.eventBus.emit({
      type: 'install.queued',
      projectId,
      payload: { packageName },
    });

    return this.jobQueue.runInstall(`install:${packageName}`, async () => {
      this.eventBus.emit({
        type: 'install.started',
        projectId,
        payload: { packageName },
      });
      try {
        await this.runTlmgrInstall(packageName);
        this.eventBus.emit({
          type: 'install.finished',
          projectId,
          payload: { packageName },
        });
        return { packageName, installed: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.eventBus.emit({
          type: 'install.failed',
          projectId,
          payload: { packageName, message },
        });
        return { packageName, installed: false, message };
      }
    });
  }

  private runTlmgrInstall(packageName: string): Promise<void> {
    const texmfHome = process.env.TEXMFHOME;
    if (!texmfHome) {
      return Promise.reject(
        new Error('TEXMFHOME is not set; cannot determine tlmgr usertree'),
      );
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        'tlmgr',
        ['--usertree', texmfHome, '--usermode', 'install', packageName],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let output = '';
      const capture = (chunk: Buffer) => {
        if (output.length < 8192) {
          output += chunk.toString('utf8');
        }
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);

      child.on('exit', (code) => {
        if (code === 0) {
          if (/already present/i.test(output)) {
            // Legitimately reachable now that prefetch (PrefetchWatcherService)
            // can install a package in the background before the compile
            // retry loop ever tries it: by the time CompileService calls
            // resolveAndInstall for the same missing file, tlmgr correctly
            // reports it as already present. Treat this as success — the
            // package genuinely is installed — not a failure; the retry
            // loop's own `attempted` set (CompileService) already bounds each
            // file to one resolveAndInstall call per compile, so this can't
            // spin even if the install actually never lands.
            this.logger.log(`Package already present: ${packageName}`);
            resolve();
            return;
          }
          this.logger.log(`Installed package: ${packageName}`);
          resolve();
        } else {
          reject(
            new Error(
              `tlmgr install ${packageName} failed (exit ${code}): ${output.trim()}`,
            ),
          );
        }
      });
      child.on('error', reject);
    });
  }
}
