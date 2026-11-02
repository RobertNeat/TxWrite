import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service.js';

@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string): string {
    return this.i18n.t(key);
  }
}
