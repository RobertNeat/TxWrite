import { Injectable, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service.js';
import type {
  CompileResult,
  Profile,
  Project,
  ProjectFileEntry,
  SynctexEditResult,
} from './api.types.js';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly auth = inject(AuthService);

  /**
   * Cookie-based auth means fetch() already sends credentials same-origin —
   * no Authorization header to attach. On a 401 (expired access-token
   * cookie), refreshes once and retries the request exactly once.
   */
  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    let response = await fetch(url, init);
    if (response.status === 401 && (await this.auth.refreshOnce()) === 'ok') {
      response = await fetch(url, init);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`${init?.method ?? 'GET'} ${url} failed (${response.status}): ${body}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  /** Refreshes first if the access token is near/past expiry — avoids a browser-driven
   * download (no 401-retry possible) silently saving an error body as the file. */
  async ensureFreshSession(): Promise<void> {
    await this.auth.ready;
    if (!this.auth.isAuthenticated()) return;
    const response = await fetch('/api/auth/me');
    if (response.status === 401) {
      await this.auth.refreshOnce();
    }
  }
  // Profiles
  listProfiles(): Promise<Profile[]> {
    return this.request('/api/profiles');
  }

  createProfile(displayName: string): Promise<Profile> {
    return this.request('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
  }

  deleteProfile(id: string): Promise<void> {
    return this.request(`/api/profiles/${id}`, { method: 'DELETE' });
  }

  // Projects
  listProjects(): Promise<Project[]> {
    return this.request('/api/projects');
  }

  getProject(id: string): Promise<Project> {
    return this.request(`/api/projects/${id}`);
  }

  createProject(input: {
    name: string;
    ownerProfileId: string;
    engine?: string;
    mainFile?: string;
  }): Promise<Project> {
    return this.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  importProjectZip(name: string, ownerProfileId: string, file: Blob): Promise<Project> {
    const params = new URLSearchParams({ name, ownerProfileId });
    return this.request(`/api/projects/import?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
  }

  updateProject(
    id: string,
    input: { name?: string; engine?: string; mainFile?: string },
  ): Promise<Project> {
    return this.request(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  deleteProject(id: string): Promise<void> {
    return this.request(`/api/projects/${id}`, { method: 'DELETE' });
  }

  // Files
  listFiles(projectId: string): Promise<ProjectFileEntry[]> {
    return this.request(`/api/projects/${projectId}/files`);
  }

  /** Absolute, pasteable raw-file URL (GitHub-raw-link style) — the browser opens/downloads the actual resource directly. */
  fileUrl(projectId: string, path: string): string {
    return new URL(`/api/projects/${projectId}/files/${path}`, window.location.origin).toString();
  }

  private async fetchWithRefresh(url: string, init?: RequestInit): Promise<Response> {
    let response = await fetch(url, init);
    if (response.status === 401 && (await this.auth.refreshOnce()) === 'ok') {
      response = await fetch(url, init);
    }
    return response;
  }

  async readFile(projectId: string, path: string): Promise<string> {
    const response = await this.fetchWithRefresh(`/api/projects/${projectId}/files/${path}`);
    if (!response.ok) {
      throw new Error(`Failed to read ${path} (${response.status})`);
    }
    return response.text();
  }

  async writeFile(projectId: string, path: string, content: string | Blob): Promise<void> {
    const response = await this.fetchWithRefresh(`/api/projects/${projectId}/files/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: content,
    });
    if (!response.ok) {
      throw new Error(`Failed to write ${path} (${response.status})`);
    }
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    const response = await this.fetchWithRefresh(`/api/projects/${projectId}/files/${path}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete ${path} (${response.status})`);
    }
  }

  /** Proactive prefetch (architecture.md section 6.4): reports current editor content so the
   * backend can install referenced packages/fonts in the background before compile is pressed. */
  scan(projectId: string, file: string, content: string): Promise<{ files: string[] }> {
    return this.request(`/api/projects/${projectId}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, content }),
    });
  }

  moveFile(projectId: string, from: string, to: string): Promise<{ from: string; to: string }> {
    return this.request(`/api/projects/${projectId}/files/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
  }

  exportZipUrl(projectId: string): string {
    return `/api/projects/${projectId}/export.zip`;
  }

  createDir(projectId: string, path: string): Promise<{ path: string }> {
    return this.request(`/api/projects/${projectId}/dirs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  }

  // Compile
  compile(projectId: string, targetFile?: string): Promise<CompileResult> {
    const query = targetFile ? `?file=${encodeURIComponent(targetFile)}` : '';
    return this.request(`/api/projects/${projectId}/compile${query}`, { method: 'POST' });
  }

  outputPdfUrl(projectId: string, targetFile?: string, cacheBust?: number): string {
    const params = new URLSearchParams();
    if (targetFile) {
      params.set('file', targetFile);
    }
    if (cacheBust !== undefined) {
      params.set('t', String(cacheBust));
    }
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return `/api/projects/${projectId}/output.pdf${query}`;
  }

  synctexEdit(
    projectId: string,
    page: number,
    x: number,
    y: number,
    targetFile?: string,
  ): Promise<SynctexEditResult> {
    const fileParam = targetFile ? `&file=${encodeURIComponent(targetFile)}` : '';
    return this.request(
      `/api/projects/${projectId}/synctex?page=${page}&x=${x}&y=${y}${fileParam}`,
    );
  }

  async exportDocument(
    projectId: string,
    format: 'md' | 'tex' | 'html' | 'docx',
    targetFile?: string,
  ): Promise<{ blob: Blob; filename?: string }> {
    const params = new URLSearchParams({ format });
    if (targetFile) {
      params.set('file', targetFile);
    }
    const response = await this.fetchWithRefresh(
      `/api/projects/${projectId}/export?${params.toString()}`,
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Export failed (${response.status}): ${body}`);
    }
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : undefined;
    return { blob: await response.blob(), filename };
  }
}
