import { Injectable } from '@angular/core';
import type {
  CompileResult,
  Profile,
  Project,
  ProjectFileEntry,
  SynctexEditResult,
} from './api.types.js';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${init?.method ?? 'GET'} ${url} failed (${response.status}): ${body}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  // Profiles
  listProfiles(): Promise<Profile[]> {
    return request('/api/profiles');
  }

  createProfile(displayName: string): Promise<Profile> {
    return request('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
  }

  deleteProfile(id: string): Promise<void> {
    return request(`/api/profiles/${id}`, { method: 'DELETE' });
  }

  // Projects
  listProjects(): Promise<Project[]> {
    return request('/api/projects');
  }

  getProject(id: string): Promise<Project> {
    return request(`/api/projects/${id}`);
  }

  createProject(input: {
    name: string;
    ownerProfileId: string;
    engine?: string;
    mainFile?: string;
  }): Promise<Project> {
    return request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  updateProject(
    id: string,
    input: { name?: string; engine?: string; mainFile?: string },
  ): Promise<Project> {
    return request(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  deleteProject(id: string): Promise<void> {
    return request(`/api/projects/${id}`, { method: 'DELETE' });
  }

  // Files
  listFiles(projectId: string): Promise<ProjectFileEntry[]> {
    return request(`/api/projects/${projectId}/files`);
  }

  /** Absolute, pasteable raw-file URL (GitHub-raw-link style) — the browser opens/downloads the actual resource directly. */
  fileUrl(projectId: string, path: string): string {
    return new URL(`/api/projects/${projectId}/files/${path}`, window.location.origin).toString();
  }

  async readFile(projectId: string, path: string): Promise<string> {
    const response = await fetch(`/api/projects/${projectId}/files/${path}`);
    if (!response.ok) {
      throw new Error(`Failed to read ${path} (${response.status})`);
    }
    return response.text();
  }

  async writeFile(projectId: string, path: string, content: string | Blob): Promise<void> {
    const response = await fetch(`/api/projects/${projectId}/files/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: content,
    });
    if (!response.ok) {
      throw new Error(`Failed to write ${path} (${response.status})`);
    }
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    const response = await fetch(`/api/projects/${projectId}/files/${path}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Failed to delete ${path} (${response.status})`);
    }
  }

  moveFile(projectId: string, from: string, to: string): Promise<{ from: string; to: string }> {
    return request(`/api/projects/${projectId}/files/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
  }

  createDir(projectId: string, path: string): Promise<{ path: string }> {
    return request(`/api/projects/${projectId}/dirs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  }

  // Compile
  compile(projectId: string, targetFile?: string): Promise<CompileResult> {
    const query = targetFile ? `?file=${encodeURIComponent(targetFile)}` : '';
    return request(`/api/projects/${projectId}/compile${query}`, { method: 'POST' });
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
    return request(`/api/projects/${projectId}/synctex?page=${page}&x=${x}&y=${y}${fileParam}`);
  }
}
