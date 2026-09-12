import type { AppConfig, Meeting } from '../../shared/types';
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export async function request<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error || 'Something went wrong. Please try again.', response.status);
  return data as T;
}
export const api = {
  config: () => request<AppConfig>('/config'),
  meetings: () => request<Meeting[]>('/meetings'),
  create: (mode: 'live' | 'demo') => request<Meeting>('/meetings', { mode }),
  meeting: (id: string) => request<Meeting>(`/meetings/${id}`),
  transcript: (
    id: string,
    text: string,
    role: 'user' | 'assistant' = 'user',
    eventId?: string,
    audio = false,
  ) =>
    request<Meeting>(`/meetings/${id}/transcript`, {
      text,
      role,
      eventId,
      audio,
    }),
  close: (id: string) => request<Meeting>(`/meetings/${id}/close`, {}),
  retry: (id: string) => request<Meeting>(`/meetings/${id}/retry`, {}),
  demoNext: (id: string) => request<Meeting>(`/meetings/${id}/demo`, {}),
  delegate: (id: string, delegationId: string) =>
    request<{ text: string; revision: number; speak?: boolean }>(
      `/meetings/${id}/delegate`,
      { delegationId },
    ),
  refreshWorkspace: (id: string, documentId?: string, force = false) =>
    request<Meeting>(`/meetings/${encodeURIComponent(id)}/workspace/refresh`, { documentId, force }),
  updateWorkspaceDrafts: (id: string) =>
    request<Meeting>(`/meetings/${encodeURIComponent(id)}/workspace/update`, {}),
  addWorkspaceComment: (id: string, documentId: string, content: string, parentId?: string) =>
    request<Meeting>(`/meetings/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/comments`, { content, parentId }),
  resolveWorkspaceDraft: (id: string, documentId: string, action: 'keep-workspace' | 'apply-draft', draftId: string, workspaceVersion: string) =>
    request<Meeting>(`/meetings/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/resolve`, { action, draftId, workspaceVersion }),
};
