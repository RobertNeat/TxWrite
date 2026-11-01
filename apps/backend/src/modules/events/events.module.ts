import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { EventBusService } from './event-bus.service.js';

@Module({
  controllers: [EventsController],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
