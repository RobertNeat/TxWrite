import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/editor/editor.component.js').then((m) => m.EditorComponent),
  },
];
