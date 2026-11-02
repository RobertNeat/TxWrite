import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database/database.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectFilesService } from './project-files.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectFilesService],
  exports: [ProjectsService, ProjectFilesService],
})
export class ProjectsModule {}
