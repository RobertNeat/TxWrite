import { Routes } from '@angular/router';

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
    loadComponent: () =>
      import('./features/workspace/project-workspace.component.js').then(
        (m) => m.ProjectWorkspaceComponent,
      ),
  },
];
