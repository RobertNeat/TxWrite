import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
} from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { PrefetchWatcherService } from './prefetch-watcher.service.js';

interface ScanDto {
  file?: string;
  content?: string;
}

@Controller('projects')
export class PrefetchWatcherController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly prefetchWatcher: PrefetchWatcherService,
  ) {}

  @Post(':id/scan')
  scan(
    @Param('id') id: string,
    @Body() dto: ScanDto,
    @CurrentUserId() userId: string,
  ): { files: string[] } {
    this.projectsService.assertProjectAccess(id, userId);
    const file = dto.file?.trim();
    if (!file || typeof dto.content !== 'string') {
      throw new BadRequestException('file and content are required');
    }
    const files = this.prefetchWatcher.scan(id, file, dto.content);
    return { files };
  }
}
