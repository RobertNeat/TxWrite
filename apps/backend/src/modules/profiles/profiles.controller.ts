import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { ProfilesService } from './profiles.service.js';
import type { Profile } from './profile.entity.js';

interface CreateProfileDto {
  displayName?: string;
}

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

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
}
