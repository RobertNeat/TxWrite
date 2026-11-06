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
import { CurrentUserId } from '../auth/current-user.decorator.js';
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
  findAll(@CurrentUserId() userId: string): Profile[] {
    return this.profilesService.findAll(userId);
  }

  @Post()
  create(
    @Body() dto: CreateProfileDto,
    @CurrentUserId() userId: string,
  ): Profile {
    const displayName = dto.displayName?.trim();
    if (!displayName) {
      throw new BadRequestException('displayName is required');
    }
    return this.profilesService.create(displayName, userId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): { id: string } {
    const deletedProjectIds = this.profilesService.delete(id, userId);
    for (const projectId of deletedProjectIds) {
      this.projectFiles.deleteProjectDir(projectId);
    }
    return { id };
  }
}
