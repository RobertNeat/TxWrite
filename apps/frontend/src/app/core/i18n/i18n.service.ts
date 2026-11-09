import { Injectable, computed, signal } from '@angular/core';
import { translations, type Lang } from './translations.js';

const STORAGE_KEY = 'lang';
const DEFAULT_LANG: Lang = 'pl';

function readStoredLang(): Lang {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_LANG;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'pl' ? stored : DEFAULT_LANG;
}

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>(readStoredLang());
  readonly dictionary = computed(() => translations[this.lang()]);

  setLang(lang: Lang): void {
    this.lang.set(lang);
    localStorage?.setItem(STORAGE_KEY, lang);
  }

  t(key: string, params?: Record<string, string>): string {
    const template = this.dictionary()[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
  }
}
