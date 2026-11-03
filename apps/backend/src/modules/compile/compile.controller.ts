import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import {
  CompileService,
  type CompileResultWithInstalls,
} from './compile.service.js';
import { SynctexService, type SynctexEditResult } from './synctex.service.js';

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
  ) {}

  @Post('compile')
  async compile(
    @Param('id') id: string,
    @Query('file') file?: string,
  ): Promise<CompileResultWithInstalls> {
    return this.compileService.compile(id, file);
  }

  @Get('output.pdf')
  getOutputPdf(
    @Param('id') id: string,
    @Query('file') file: string | undefined,
    @Res() reply: FastifyReply,
  ): void {
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
    @Query('file') file?: string,
  ): Promise<SynctexEditResult> {
    return this.synctexService.edit(
      id,
      parseCoordinate('page', page),
      parseCoordinate('x', x),
      parseCoordinate('y', y),
      file,
    );
  }
}
