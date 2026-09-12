import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from './app';
import { MeetingStore } from './store';
import { MeetingWorker } from './worker';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sidekick-api-'));
  const store = new MeetingStore(directory);
  const workerMethods = {
    schedule: vi.fn(),
    delegate: vi.fn(),
    refreshWorkspace: vi.fn(async (id: string) => store.get(id)),
    updateFromWorkspace: vi.fn((id: string) => store.get(id)),
    addWorkspaceComment: vi.fn(async (id: string) => store.get(id)),
    resolveWorkspaceDraft: vi.fn(async (id: string) => store.get(id)),
  };
  const worker = workerMethods as unknown as MeetingWorker;
  const app = createApp(store, worker);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', (error?: Error) =>
      error ? reject(error) : resolve(s),
    );
  });
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}/api`;
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  const post = async (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { store, worker, workerMethods, base, post };
}
describe('meeting HTTP lifecycle', () => {
  it('deduplicates voice delivery and preserves split-word audio fragments', async () => {
    const { post, store } = await setup();
    const meeting = await (await post('/meetings', { mode: 'live' })).json();
    const path = `/meetings/${meeting.id}/transcript`;
    await post(path, {
      text: 'We should inves',
      role: 'user',
      eventId: 'a',
      audio: true,
    });
    await post(path, {
      text: 'tigate the options.',
      role: 'user',
      eventId: 'b',
      audio: true,
    });
    await post(path, {
      text: 'tigate the options.',
      role: 'user',
      eventId: 'b',
      audio: true,
    });
    expect(store.get(meeting.id).transcript.map((t) => t.text)).toEqual([
      'We should investigate the options.',
    ]);
    expect(store.get(meeting.id).revision).toBe(2);
  });
  it('closes once, invalidates in-flight work and rejects later contributions', async () => {
    const { post, store } = await setup();
    const meeting = await (await post('/meetings', { mode: 'live' })).json();
    await post(`/meetings/${meeting.id}/close`, {});
    await post(`/meetings/${meeting.id}/close`, {});
    expect(store.get(meeting.id).phase).toBe('closing');
    expect(store.get(meeting.id).revision).toBe(1);
    expect(
      (await post(`/meetings/${meeting.id}/transcript`, { text: 'Late' }))
        .status,
    ).toBe(409);
  });
  it('keeps demo work local and exports a marked handover', async () => {
    const { post, store, base, worker } = await setup();
    const meeting = await (await post('/meetings', { mode: 'demo' })).json();
    for (let i = 0; i < 4; i++) await post(`/meetings/${meeting.id}/demo`, {});
    const final = store.get(meeting.id);
    expect(final.phase).toBe('ended');
    expect(final.documents).toHaveLength(4);
    expect(final.documents.map(document => document.format ?? 'document')).toEqual([
      'document', 'document', 'presentation', 'spreadsheet',
    ]);
    expect(final.documents.every(document => document.saveStatus === 'local')).toBe(true);
    expect(final.documents.find(document => document.format === 'presentation')?.presentation?.slides).toHaveLength(2);
    expect(final.documents.find(document => document.format === 'spreadsheet')?.spreadsheet?.sheets).toHaveLength(2);
    expect(
      final.followUps.every((f) => f.owner === null && f.status === 'proposed'),
    ).toBe(true);
    expect(worker.schedule).not.toHaveBeenCalled();
    expect(
      await (await fetch(`${base}/meetings/${meeting.id}/export`)).text(),
    ).toContain('Simulated demo');
  });
  it('rejects cross-origin access and invalid requests', async () => {
    const { base, post } = await setup();
    expect(
      (
        await fetch(`${base}/config`, {
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
    ).toBe(403);
    expect((await post('/meetings', { mode: 'fake' })).status).toBe(400);
    expect((await fetch(`${base}/meetings/missing`)).status).toBe(404);
  });
});

describe('workspace feedback HTTP routes', () => {
  it.each([
    { path: '/workspace/refresh', body: { documentId: 'local-file', force: true }, method: 'refreshWorkspace', args: [{ documentId: 'local-file', force: true }] },
    { path: '/workspace/update', body: {}, method: 'updateFromWorkspace', args: [] },
    { path: '/documents/local-file/comments', body: { content: 'Please clarify the cost.', parentId: 'thread-comment' }, method: 'addWorkspaceComment', args: ['local-file', 'Please clarify the cost.', 'thread-comment'] },
    { path: '/documents/local-file/resolve', body: { action: 'apply-draft', draftId: 'proposed-1', workspaceVersion: 'reviewed-version' }, method: 'resolveWorkspaceDraft', args: ['local-file', { action: 'apply-draft', draftId: 'proposed-1', workspaceVersion: 'reviewed-version' }] },
  ] as const)('routes $path with the reviewed fields and returns only public meeting state', async ({ path, body, method, args }) => {
    const { post, store, workerMethods } = await setup();
    const created = await (await post('/meetings', { mode: 'live' })).json();
    const meeting = store.get(created.id);
    meeting.agentSessionId = 'private-agent-session';
    meeting.documentLastContents = { internal: 'Private canonical comparison' };
    meeting.documentSnapshots = { internal: { id: 'remote-id', title: 'Private raw snapshot', content: 'Raw internal document' } };
    meeting.pendingDraftSources = { internal: { title: 'Private draft source', kind: 'notes', content: 'Raw source context', status: 'draft' } };
    store.save(meeting);

    const response = await post(`/meetings/${meeting.id}${path}`, body);

    expect(response.status).toBe(method === 'addWorkspaceComment' ? 201 : 200);
    expect(workerMethods[method]).toHaveBeenCalledWith(meeting.id, ...args);
    const result = await response.json();
    expect(result).toMatchObject({ id: meeting.id, stateVersion: meeting.stateVersion });
    for (const key of ['agentSessionId', 'documentLastContents', 'documentSnapshots', 'pendingDraftSources']) expect(result).not.toHaveProperty(key);
    expect(JSON.stringify(result)).not.toContain('Raw internal document');
  });

  it.each([
    { path: '/workspace/refresh', body: { force: 'yes' } },
    { path: '/workspace/refresh', body: { documentId: '' } },
    { path: '/documents/local-file/comments', body: { content: '' } },
    { path: '/documents/local-file/comments', body: { content: 12 } },
    { path: '/documents/local-file/resolve', body: { action: 'overwrite-everything', draftId: 'draft', workspaceVersion: 'version' } },
    { path: '/documents/local-file/resolve', body: { action: 'apply-draft', workspaceVersion: 'version' } },
    { path: '/documents/local-file/resolve', body: { action: 'keep-workspace', draftId: 'draft' } },
    { path: '/documents/local-file/resolve', body: { action: 'apply-draft', draftId: '', workspaceVersion: 'version' } },
  ])('rejects malformed feedback for $path before invoking the worker', async ({ path, body }) => {
    const { post, workerMethods } = await setup();
    const meeting = await (await post('/meetings', { mode: 'live' })).json();
    const response = await post(`/meetings/${meeting.id}${path}`, body);
    expect(response.status).toBe(400);
    expect(workerMethods.refreshWorkspace).not.toHaveBeenCalled();
    expect(workerMethods.addWorkspaceComment).not.toHaveBeenCalled();
    expect(workerMethods.resolveWorkspaceDraft).not.toHaveBeenCalled();
  });

  it('preserves a stale-review conflict response so the browser can request another review', async () => {
    const { post, workerMethods } = await setup();
    const meeting = await (await post('/meetings', { mode: 'live' })).json();
    workerMethods.resolveWorkspaceDraft.mockRejectedValueOnce(Object.assign(new Error('The workspace file changed. Review the refreshed versions.'), { status: 409 }));
    const response = await post(`/meetings/${meeting.id}/documents/local-file/resolve`, { action: 'apply-draft', draftId: 'draft-1', workspaceVersion: 'old-version' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'The workspace file changed. Review the refreshed versions.' });
  });

  it('returns not found for a workspace refresh on an unknown meeting', async () => {
    const { post } = await setup();
    expect((await post('/meetings/missing/workspace/refresh', { force: true })).status).toBe(404);
  });
});
