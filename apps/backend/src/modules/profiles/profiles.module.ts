import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database/database.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfilesService } from './profiles.service.js';

@Module({
  imports: [DatabaseModule, ProjectsModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
