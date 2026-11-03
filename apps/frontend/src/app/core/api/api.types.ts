// Mirrors backend DTOs manually (no packages/shared yet — see
// docs/contracts/api.md for the SSE event-type sync note). Keep in sync with
// apps/backend/src/modules/**/*.entity.ts and *.service.ts return types.

export interface Profile {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  ownerProfileId: string;
  engine: string;
  mainFile: string;
  templateOrigin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileEntry {
  path: string;
  size: number;
  isDirectory: boolean;
}

export interface CompileDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
}

export interface MissingFile {
  fileName: string;
}

export interface InstallOutcome {
  packageName: string;
  installed: boolean;
  message?: string;
}

export interface CompileResult {
  success: boolean;
  diagnostics: CompileDiagnostic[];
  missingFiles: MissingFile[];
  log: string;
  pdfPath: string | null;
  timedOut: boolean;
  installs: InstallOutcome[];
}

export interface SynctexEditResult {
  path: string;
  line: number;
}

// Mirrors apps/backend/src/modules/events/event-bus.service.ts AppEventType.
export type AppEventType =
  | 'compile.started'
  | 'compile.finished'
  | 'install.queued'
  | 'install.started'
  | 'install.finished'
  | 'install.failed'
  | 'font.resolving'
  | 'font.resolved'
  | 'font.failed';

export interface AppEvent {
  type: AppEventType;
  projectId?: string;
  payload?: unknown;
  timestamp: string;
}
