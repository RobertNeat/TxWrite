import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard.js';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/profiles/profile-picker.component.js').then(
        (m) => m.ProfilePickerComponent,
      ),
  },
  {
    path: 'projects/:projectId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/workspace/project-workspace.component.js').then(
        (m) => m.ProjectWorkspaceComponent,
      ),
  },
];
