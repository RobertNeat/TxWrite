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
import { attachmentDisposition } from '../../common/files/content-disposition.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
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
  findAll(@CurrentUserId() userId: string): Project[] {
    return this.projectsService.findAll(userId);
  }

  @Post()
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUserId() userId: string,
  ): Project {
    const name = dto.name?.trim();
    const ownerProfileId = dto.ownerProfileId?.trim();
    if (!name || !ownerProfileId) {
      throw new BadRequestException('name and ownerProfileId are required');
    }
    const project = this.projectsService.create(
      {
        name,
        ownerProfileId,
        engine: dto.engine,
        mainFile: dto.mainFile,
      },
      userId,
    );
    this.projectFiles.createProjectDir(project.id);
    return project;
  }

  @Post('import')
  async importZip(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    const query = request.query as { ownerProfileId?: string; name?: string };
    const ownerProfileId = query.ownerProfileId?.trim();
    const name = query.name?.trim();
    if (!ownerProfileId || !name) {
      throw new BadRequestException('ownerProfileId and name are required');
    }
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException(
        'Expected application/octet-stream request body',
      );
    }

    const project = this.projectsService.create(
      { name, ownerProfileId },
      userId,
    );
    this.projectFiles.createProjectDir(project.id);
    try {
      await this.projectFiles.importArchive(project.id, body);
    } catch (error) {
      this.projectsService.delete(project.id);
      this.projectFiles.deleteProjectDir(project.id);
      throw error;
    }
    reply.status(201).send(project);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUserId() userId: string): Project {
    return this.projectsService.assertProjectAccess(id, userId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUserId() userId: string,
  ): Project {
    this.projectsService.assertProjectAccess(id, userId);
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): { id: string } {
    this.projectsService.assertProjectAccess(id, userId);
    this.projectsService.delete(id);
    this.projectFiles.deleteProjectDir(id);
    return { id };
  }

  @Get(':id/files')
  listFiles(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): ProjectFileEntry[] {
    this.projectsService.assertProjectAccess(id, userId);
    return this.projectFiles.listFiles(id);
  }

  @Post(':id/files/move')
  moveFile(
    @Param('id') id: string,
    @Body() dto: MoveFileDto,
    @CurrentUserId() userId: string,
  ): { from: string; to: string } {
    this.projectsService.assertProjectAccess(id, userId);
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
    @CurrentUserId() userId: string,
  ): { path: string } {
    this.projectsService.assertProjectAccess(id, userId);
    const path = dto.path?.trim();
    if (!path) {
      throw new BadRequestException('path is required');
    }
    this.wrapUnsafePath(() => this.projectFiles.createDir(id, path));
    return { path };
  }

  @Get(':id/export.zip')
  exportZip(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
    @CurrentUserId() userId: string,
  ): void {
    const project = this.projectsService.assertProjectAccess(id, userId);
    const archive = this.projectFiles.createArchive(id);
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', attachmentDisposition(project.name, 'zip'))
      .send(archive);
  }

  @Get(':id/files/*')
  getFile(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUserId() userId: string,
  ): void {
    this.projectsService.assertProjectAccess(id, userId);
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
    @CurrentUserId() userId: string,
  ): void {
    this.projectsService.assertProjectAccess(id, userId);
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
    @CurrentUserId() userId: string,
  ): void {
    this.projectsService.assertProjectAccess(id, userId);
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
