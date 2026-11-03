import { Component } from '@angular/core';

@Component({
  selector: 'app-brand',
  standalone: true,
  template: `
    <div id="brand" class="brand">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#9EB7E5" />
        <path
          d="M8.5 10.5h15M16 10.5v13"
          stroke="#223868"
          stroke-width="3"
          stroke-linecap="round"
          fill="none"
        />
      </svg>
      <div>
        <b id="brand-title">Redaktor</b>
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
export class BrandComponent {}
