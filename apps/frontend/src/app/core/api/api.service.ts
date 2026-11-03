import { Injectable } from '@angular/core';
import type { CompileResult, Profile, Project, ProjectFileEntry } from './api.types.js';

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

  // Compile
  compile(projectId: string): Promise<CompileResult> {
    return request(`/api/projects/${projectId}/compile`, { method: 'POST' });
  }

  outputPdfUrl(projectId: string): string {
    return `/api/projects/${projectId}/output.pdf`;
  }
}
