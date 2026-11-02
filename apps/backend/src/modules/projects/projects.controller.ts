import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProjectsService } from './projects.service.js';
import { ProjectFilesService } from './project-files.service.js';
import { UnsafePathError } from '../../common/files/safe-path.js';
import type { Project } from './project.entity.js';

interface CreateProjectDto {
  name?: string;
  ownerProfileId?: string;
  engine?: string;
  mainFile?: string;
}

interface UpdateProjectDto {
  name?: string;
  engine?: string;
  mainFile?: string;
}

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectFiles: ProjectFilesService,
  ) {}

  @Get()
  findAll(): Project[] {
    return this.projectsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateProjectDto): Project {
    const name = dto.name?.trim();
    const ownerProfileId = dto.ownerProfileId?.trim();
    if (!name || !ownerProfileId) {
      throw new BadRequestException('name and ownerProfileId are required');
    }
    const project = this.projectsService.create({
      name,
      ownerProfileId,
      engine: dto.engine,
      mainFile: dto.mainFile,
    });
    this.projectFiles.createProjectDir(project.id);
    return project;
  }

  @Get(':id')
  findOne(@Param('id') id: string): Project {
    return this.projectsService.findByIdOrThrow(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto): Project {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { id: string } {
    this.projectsService.delete(id);
    this.projectFiles.deleteProjectDir(id);
    return { id };
  }

  @Get(':id/files/*')
  getFile(@Param('id') id: string, @Req() request: FastifyRequest): Buffer {
    this.projectsService.findByIdOrThrow(id);
    const relativePath = this.extractFilePath(request.url, id);
    return this.wrapUnsafePath(() =>
      this.projectFiles.readFile(id, relativePath),
    );
  }

  @Put(':id/files/*')
  putFile(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    this.projectsService.findByIdOrThrow(id);
    const relativePath = this.extractFilePath(request.url, id);
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException(
        'Expected application/octet-stream request body',
      );
    }
    this.wrapUnsafePath(() =>
      this.projectFiles.writeFile(id, relativePath, body),
    );
    reply.status(204).send();
  }

  @Delete(':id/files/*')
  deleteFile(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    this.projectsService.findByIdOrThrow(id);
    const relativePath = this.extractFilePath(request.url, id);
    this.wrapUnsafePath(() => this.projectFiles.deleteFile(id, relativePath));
    reply.status(204).send();
  }

  private extractFilePath(url: string, id: string): string {
    const prefix = `/api/projects/${id}/files/`;
    const path = url.startsWith(prefix) ? url.slice(prefix.length) : '';
    return decodeURIComponent(path.split('?')[0]);
  }

  private wrapUnsafePath<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof UnsafePathError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
