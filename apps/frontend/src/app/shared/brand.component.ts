import { Component } from '@angular/core';
import { APP_NAME } from './app-name';

@Component({
  selector: 'app-brand',
  standalone: true,
  template: `
    <div id="brand" class="brand">
      <img id="brand-logo" class="brand-logo" src="/tx_logo.png" width="30" height="30" alt="" />
      <div>
        <b id="brand-title">{{ APP_NAME }}</b>
        <small id="brand-subtitle">Markdown · LaTeX</small>
      </div>
    </div>
  `,
  styles: [
    `
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .brand-logo {
        display: block;
        border-radius: 8px;
        object-fit: cover;
      }
      .brand b {
        display: block;
        font-weight: 600;
        font-size: 16px;
        line-height: 1.1;
      }
      .brand small {
        display: block;
        font-size: 12px;
        line-height: 1.2;
        color: rgba(255, 255, 255, 0.86);
      }
    `,
  ],
})
export class BrandComponent {
  readonly APP_NAME = APP_NAME;
}
