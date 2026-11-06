import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ProfilesService } from './profiles.service.js';
import { ProjectFilesService } from '../projects/project-files.service.js';
import type { Profile } from './profile.entity.js';

interface CreateProfileDto {
  displayName?: string;
}

@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly projectFiles: ProjectFilesService,
  ) {}

  @Get()
  findAll(): Profile[] {
    return this.profilesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateProfileDto): Profile {
    const displayName = dto.displayName?.trim();
    if (!displayName) {
      throw new BadRequestException('displayName is required');
    }
    return this.profilesService.create(displayName);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { id: string } {
    const deletedProjectIds = this.profilesService.delete(id);
    for (const projectId of deletedProjectIds) {
      this.projectFiles.deleteProjectDir(projectId);
    }
    return { id };
  }
}
