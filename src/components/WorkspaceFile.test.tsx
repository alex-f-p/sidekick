import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Meeting, WorkDocument, WorkspaceComment } from '../../shared/types';
import { WorkspaceComments, WorkspaceFile, WorkspaceToolbar, workspaceCommentThreads } from './WorkspaceFile';
import { api } from '../lib/api';

const document: WorkDocument = {
  id: 'file', key: 'plan', title: 'Plan', kind: 'plan', content: 'Latest workspace content.',
  status: 'draft', saveStatus: 'saved', version: 2, updatedAt: '2026-09-12T00:00:00.000Z',
  externalId: 'native-file', url: 'https://ambiguous.ai/docs/native-file',
  workspace: { status: 'current', version: 'read-version', lastCheckedAt: '2026-09-12T00:00:00.000Z', comments: [] },
};
const meeting: Meeting = {
  id: 'meeting', title: 'Team meeting', mode: 'live', phase: 'ended', startedAt: '2026-09-12T00:00:00.000Z',
  revision: 1, processedRevision: 1, working: false, summary: '', transcript: [], documents: [document],
  decisions: [], pending: [], ambiguities: [], followUps: [], activity: [], sources: [], recordSaveStatus: 'saved', demoStep: 0,
};
const comment = (id: string, parentId?: string): WorkspaceComment => ({ id, parentId, content: id, createdAt: '2026-09-12T00:00:00.000Z', resolved: false });

describe('workspace review UI', () => {
  it('opens the workspace version and requires viewing the proposal before applying', () => {
    const conflict: WorkDocument = { ...document, workspace: { ...document.workspace!, status: 'conflict' }, pendingDraft: {
      id: 'proposal', title: 'Proposed title', kind: 'plan', status: 'draft', createdAt: '2026-09-12T01:00:00.000Z', content: 'Unreviewed proposed replacement.',
    } };
    const html = renderToStaticMarkup(<WorkspaceFile meeting={meeting} document={conflict} refreshing={false} refreshError={null} onRefresh={vi.fn(async () => {})} onMeeting={vi.fn()} />);
    expect(html).toContain('Latest workspace content.');
    expect(html).not.toContain('Unreviewed proposed replacement.');
    expect(html).toContain('aria-selected="true" tabindex="0">Workspace version');
    expect(html).toContain('Keep workspace version');
    expect(html).not.toContain('Apply reviewed draft');
    expect(html).toContain('Refresh from Ambiguous');
    expect(html).toContain('Last checked');
  });

  it('offers an explicit ended-meeting update without starting it when the toolbar renders', () => {
    const update = vi.spyOn(api, 'updateWorkspaceDrafts');
    const html = renderToStaticMarkup(<WorkspaceToolbar meeting={meeting} document={document} refreshing={false} refreshError={null} onRefresh={vi.fn(async () => {})} onMeeting={vi.fn()} />);
    expect(html).toContain('Update drafts from workspace feedback');
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
    const active = renderToStaticMarkup(<WorkspaceToolbar meeting={{ ...meeting, phase: 'active' }} document={document} refreshing={false} refreshError={null} onRefresh={vi.fn(async () => {})} onMeeting={vi.fn()} />);
    expect(active).not.toContain('Update drafts from workspace feedback');
  });

  it('renders comments as text and never posts them without submission', () => {
    const post = vi.spyOn(api, 'addWorkspaceComment');
    const html = renderToStaticMarkup(<WorkspaceComments meeting={meeting} targetId="file" document={{ ...document, workspace: { ...document.workspace!, comments: [{ ...comment('one'), content: '<script>external()</script>', authorName: 'Sam', resolved: true }] } }} onMeeting={vi.fn()} />);
    expect(html).toContain('&lt;script&gt;external()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Resolved');
    expect(html).toContain('Reply to thread');
    expect(html).toContain('Post comment to Ambiguous');
    expect(html).toContain('type="submit" disabled=""');
    expect(post).not.toHaveBeenCalled();
    post.mockRestore();
  });

  it('keeps demo and local-only files free of remote actions', () => {
    const local = { ...document, externalId: undefined, url: undefined };
    const html = renderToStaticMarkup(<WorkspaceFile meeting={{ ...meeting, mode: 'demo' }} document={local} refreshing={false} refreshError={null} onRefresh={vi.fn(async () => {})} onMeeting={vi.fn()} />);
    expect(html).not.toContain('Refresh from Ambiguous');
    expect(html).not.toContain('Post comment to Ambiguous');
    expect(html).toContain('Latest workspace content.');
  });

  it('groups nested replies with an out-of-order parent and handles broken parent references', () => {
    const groups = workspaceCommentThreads([comment('third', 'second'), comment('second', 'first'), comment('first'), comment('orphan', 'missing')]);
    expect(groups.map(group => [group.root.id, group.replies.map(reply => reply.id)])).toEqual([['first', ['third', 'second']], ['orphan', []]]);
  });

  it('groups malformed cyclic threads once without losing their descendants', () => {
    const groups = workspaceCommentThreads([comment('0-child', 'a'), comment('a', 'b'), comment('b', 'a')]);
    expect(groups.map(group => [group.root.id, group.replies.map(reply => reply.id)])).toEqual([['a', ['0-child', 'b']]]);
  });
});
