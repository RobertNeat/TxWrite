import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import {
  CompileService,
  type CompileResultWithInstalls,
} from './compile.service.js';

@Controller('projects/:id')
export class CompileController {
  constructor(private readonly compileService: CompileService) {}

  @Post('compile')
  async compile(@Param('id') id: string): Promise<CompileResultWithInstalls> {
    return this.compileService.compile(id);
  }

  @Get('output.pdf')
  getOutputPdf(@Param('id') id: string, @Res() reply: FastifyReply): void {
    const pdfPath = this.compileService.outputPdfPath(id);
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
}
