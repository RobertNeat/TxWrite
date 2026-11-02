import { Component, OnInit } from '@angular/core';
import { EventStreamService } from '../../core/events/event-stream.service.js';

@Component({
  selector: 'app-status-bar',
  standalone: true,
  template: `
    <span id="status-bar-connection" class="status" [class.connected]="eventStream.connected()">
      {{ eventStream.connected() ? 'connected' : 'disconnected' }}
    </span>
  `,
  styles: [
    `
      .status {
        font-size: 0.8rem;
        color: #999;
      }
      .status.connected {
        color: #2a7;
      }
    `,
  ],
})
export class StatusBarComponent implements OnInit {
  constructor(public readonly eventStream: EventStreamService) {}

  ngOnInit(): void {
    this.eventStream.connect();
  }
}
