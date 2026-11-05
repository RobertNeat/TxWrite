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
import {
  ProjectFilesService,
  type ProjectFileEntry,
} from './project-files.service.js';
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

interface MoveFileDto {
  from?: string;
  to?: string;
}

interface CreateDirDto {
  path?: string;
}

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

/** Browsers need a real image/pdf Content-Type to render inline (<img>, a pasted raw-file URL in a new tab) instead of downloading — the fallback keeps everything else as a generic download. */
export function mimeTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
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

  @Get(':id/files')
  listFiles(@Param('id') id: string): ProjectFileEntry[] {
    this.projectsService.findByIdOrThrow(id);
    return this.projectFiles.listFiles(id);
  }

  @Post(':id/files/move')
  moveFile(
    @Param('id') id: string,
    @Body() dto: MoveFileDto,
  ): { from: string; to: string } {
    this.projectsService.findByIdOrThrow(id);
    const from = dto.from?.trim();
    const to = dto.to?.trim();
    if (!from || !to) {
      throw new BadRequestException('from and to are required');
    }
    this.wrapUnsafePath(() => this.projectFiles.moveFile(id, from, to));
    return { from, to };
  }

  @Post(':id/dirs')
  createDir(
    @Param('id') id: string,
    @Body() dto: CreateDirDto,
  ): { path: string } {
    this.projectsService.findByIdOrThrow(id);
    const path = dto.path?.trim();
    if (!path) {
      throw new BadRequestException('path is required');
    }
    this.wrapUnsafePath(() => this.projectFiles.createDir(id, path));
    return { path };
  }

  @Get(':id/files/*')
  getFile(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    this.projectsService.findByIdOrThrow(id);
    const relativePath = this.extractFilePath(request.url, id);
    const content = this.wrapUnsafePath(() =>
      this.projectFiles.readFile(id, relativePath),
    );
    reply.header('Content-Type', mimeTypeFor(relativePath)).send(content);
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
