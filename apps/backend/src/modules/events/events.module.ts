import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { EventBusService } from './event-bus.service.js';
import { ProjectsModule } from '../projects/projects.module.js';

@Module({
  imports: [ProjectsModule],
  controllers: [EventsController],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
