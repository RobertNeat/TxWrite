import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StatusBarComponent } from './features/status-bar/status-bar.component.js';

@Component({
  imports: [RouterOutlet, StatusBarComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('frontend');
}
