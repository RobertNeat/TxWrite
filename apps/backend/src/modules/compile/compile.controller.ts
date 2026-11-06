import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import {
  CompileService,
  type CompileResultWithInstalls,
} from './compile.service.js';
import { SynctexService, type SynctexEditResult } from './synctex.service.js';
import { ExportService, type ExportFormat } from './export.service.js';
import { attachmentDisposition } from '../../common/files/content-disposition.js';
import { ProjectsService } from '../projects/projects.service.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';

const EXPORT_FORMATS: ReadonlySet<string> = new Set([
  'md',
  'tex',
  'html',
  'docx',
]);

function parseCoordinate(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(`Invalid ${name}`);
  }
  return parsed;
}

@Controller('projects/:id')
export class CompileController {
  constructor(
    private readonly compileService: CompileService,
    private readonly synctexService: SynctexService,
    private readonly exportService: ExportService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('compile')
  async compile(
    @Param('id') id: string,
    @Query('file') file: string | undefined,
    @CurrentUserId() userId: string,
  ): Promise<CompileResultWithInstalls> {
    this.projectsService.assertProjectAccess(id, userId);
    return this.compileService.compile(id, file);
  }

  @Get('output.pdf')
  getOutputPdf(
    @Param('id') id: string,
    @Query('file') file: string | undefined,
    @Res() reply: FastifyReply,
    @CurrentUserId() userId: string,
  ): void {
    this.projectsService.assertProjectAccess(id, userId);
    const pdfPath = this.compileService.outputPdfPath(id, file);
    if (!existsSync(pdfPath)) {
      throw new NotFoundException('No compiled PDF for this project yet');
    }
    // Without this, the browser (and pdf.js) can serve a cached PDF from
    // before the latest compile, since this URL never changes between
    // compiles.
    reply
      .header('Cache-Control', 'no-store')
      .type('application/pdf')
      .send(createReadStream(pdfPath));
  }

  @Get('synctex')
  async synctexEdit(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('x') x: string,
    @Query('y') y: string,
    @Query('file') file: string | undefined,
    @CurrentUserId() userId: string,
  ): Promise<SynctexEditResult> {
    this.projectsService.assertProjectAccess(id, userId);
    return this.synctexService.edit(
      id,
      parseCoordinate('page', page),
      parseCoordinate('x', x),
      parseCoordinate('y', y),
      file,
    );
  }

  @Get('export')
  async export(
    @Param('id') id: string,
    @Query('format') format: string,
    @Query('file') file: string | undefined,
    @Res() reply: FastifyReply,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    this.projectsService.assertProjectAccess(id, userId);
    if (!EXPORT_FORMATS.has(format)) {
      throw new BadRequestException(`Invalid format: ${format}`);
    }
    const sourceFile = this.compileService.exportTargetFile(id, file);
    let result;
    try {
      result = await this.exportService.export(
        id,
        sourceFile,
        format as ExportFormat,
      );
    } catch (error) {
      throw new UnprocessableEntityException(
        error instanceof Error ? error.message : 'Export failed',
      );
    }
    const baseName = sourceFile.replace(/\.(tex|md)$/i, '');
    reply
      .header('Content-Type', result.mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        attachmentDisposition(baseName, result.extension),
      )
      .send(result.content);
  }
}
