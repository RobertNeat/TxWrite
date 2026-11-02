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
    reply.type('application/pdf').send(createReadStream(pdfPath));
  }
}
