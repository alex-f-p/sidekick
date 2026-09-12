import { useId, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowUpRight, CheckCheck, Clock3, LoaderCircle, MessageSquare, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Meeting, WorkDocument, WorkspaceComment, WorkspaceSyncState } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { ArtifactIcon, ArtifactPreview, artifactFormat, artifactLabel, artifactSize } from './ArtifactPreview';
import './WorkspaceFile.css';

const syncLabels: Record<WorkspaceSyncState['status'], string> = {
  unchecked: 'Not checked yet', checking: 'Checking Ambiguous…', current: 'Up to date',
  conflict: 'Review required', error: 'Refresh failed', deleted: 'Unavailable in Ambiguous',
};

function checkedTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function safeUrl(value?: string) {
  try { const url = new URL(value ?? ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

export function WorkspaceStatus({ workspace, refreshing = false, compact = false }: {
  workspace?: WorkspaceSyncState; refreshing?: boolean; compact?: boolean;
}) {
  const status = refreshing ? 'checking' : workspace?.status ?? 'unchecked';
  return (
    <div className={`workspace-sync-status ${status}${compact ? ' compact' : ''}`}>
      <span>{status === 'checking' ? <LoaderCircle size={12} className="spin" /> : status === 'current' ? <CheckCheck size={12} /> : ['conflict', 'error', 'deleted'].includes(status) ? <AlertCircle size={12} /> : <Clock3 size={12} />}{syncLabels[status]}</span>
      {workspace?.lastCheckedAt && <time dateTime={workspace.lastCheckedAt} title={new Date(workspace.lastCheckedAt).toLocaleString()}>Last checked {checkedTime(workspace.lastCheckedAt)}</time>}
    </div>
  );
}

export function WorkspaceToolbar({ meeting, document, refreshing, refreshError, onRefresh, onMeeting }: {
  meeting: Meeting; document?: WorkDocument; refreshing: boolean; refreshError: string | null;
  onRefresh: () => Promise<void>; onMeeting: (meeting: Meeting) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const available = meeting.mode === 'live' && Boolean(document ? document.externalId || document.url : meeting.recordUrl || meeting.documents.some(item => item.externalId || item.url));
  if (!available) return null;
  async function updateDrafts() {
    if (updating || meeting.working) return;
    setUpdating(true); setActionError(null);
    try { onMeeting(await api.updateWorkspaceDrafts(meeting.id)); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not update the drafts.'); }
    finally { setUpdating(false); }
  }
  return (
    <div className="workspace-sync-toolbar">
      <div className="workspace-sync-toolbar-row">
        {document ? <WorkspaceStatus workspace={document.workspace} refreshing={refreshing} /> : (
          <div className="workspace-sync-status"><span>{refreshing ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />}{refreshing ? 'Checking Ambiguous…' : 'Ambiguous workspace'}</span>{meeting.workspaceCheckedAt && <time dateTime={meeting.workspaceCheckedAt}>Last checked {checkedTime(meeting.workspaceCheckedAt)}</time>}</div>
        )}
        <button type="button" className="button secondary compact" disabled={refreshing} onClick={() => void onRefresh()}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />Refresh from Ambiguous</button>
      </div>
      {meeting.phase === 'ended' && (
        <div className="workspace-feedback-action">
          <p>Refreshing updates these previews. Run an update when you want Sidekick to revise the drafts using workspace edits and comments.</p>
          <button type="button" className="button secondary compact" disabled={updating || meeting.working} onClick={() => void updateDrafts()}>{updating || meeting.working ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}Update drafts from workspace feedback</button>
        </div>
      )}
      {(refreshError || actionError || (!document && meeting.workspaceError)) && <p className="workspace-inline-error" role="alert">{refreshError || actionError || meeting.workspaceError}</p>}
    </div>
  );
}

export function WorkspaceFileContent({ document }: { document: WorkDocument }) {
  return <>
    <ArtifactPreview document={document} />
    {artifactFormat(document) !== 'document' && <h3 className="artifact-narrative-heading">Summary and context</h3>}
    <article className="markdown document-markdown">
      <ReactMarkdown disallowedElements={['img']} remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={safeUrl(href)} target="_blank" rel="noopener noreferrer">{children}</a> }}>{document.content}</ReactMarkdown>
    </article>
  </>;
}

/** Replies stay grouped even when the provider sends them before their parent. */
export function workspaceCommentThreads(comments: WorkspaceComment[]) {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const groups = new Map<string, { root: WorkspaceComment; replies: WorkspaceComment[] }>();
  for (const comment of comments) {
    let root = comment;
    const path = [root.id];
    while (root.parentId && byId.has(root.parentId)) {
      const cycleStart = path.indexOf(root.parentId);
      if (cycleStart >= 0) { root = byId.get(path.slice(cycleStart).sort()[0])!; break; }
      root = byId.get(root.parentId)!; path.push(root.id);
    }
    const group = groups.get(root.id) ?? { root, replies: [] };
    if (comment.id !== root.id) group.replies.push(comment);
    groups.set(root.id, group);
  }
  return [...groups.values()];
}

function CommentText({ comment }: { comment: WorkspaceComment }) {
  return <div className="workspace-comment">
    <div className="workspace-comment-meta"><strong>{comment.authorName || 'Workspace participant'}</strong><time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{new Date(comment.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {checkedTime(comment.createdAt)}</time>{comment.resolved && <span>Resolved</span>}</div>
    <p>{comment.content}</p>
  </div>;
}

export function WorkspaceComments({ meeting, document, targetId, onMeeting }: {
  meeting: Meeting; document: WorkDocument; targetId: string; onMeeting: (meeting: Meeting) => void;
}) {
  const [content, setContent] = useState('');
  const [parentId, setParentId] = useState<string>();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const inputId = useId();
  const comments = document.workspace?.comments ?? [];
  const threads = workspaceCommentThreads(comments);
  const available = meeting.mode === 'live' && Boolean(document.externalId || document.url);
  if (!available) return null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (posting || !content.trim()) return;
    setPosting(true); setError(null); setPosted(false);
    try {
      onMeeting(await api.addWorkspaceComment(meeting.id, targetId, content.trim(), parentId));
      setContent(''); setParentId(undefined); setPosted(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not post the comment. Your text is still here.'); }
    finally { setPosting(false); }
  }
  return (
    <section className="workspace-comments" aria-label="Comments from Ambiguous">
      <div className="workspace-comments-heading"><h3><MessageSquare size={16} />Comments from Ambiguous</h3><span>{comments.length}</span></div>
      {document.workspace?.commentsError && <p className="workspace-inline-error">{document.workspace.commentsError}</p>}
      {threads.length ? <ol className="workspace-comment-threads">{threads.map(({ root, replies }) => (
        <li key={root.id}>
          <CommentText comment={root} />
          {replies.length > 0 && <ol className="workspace-comment-replies">{replies.map(reply => <li key={reply.id}><CommentText comment={reply} /></li>)}</ol>}
          {document.workspace?.status !== 'deleted' && <button type="button" className="inline-link" disabled={posting} onClick={() => { setParentId(root.id); setPosted(false); }}>Reply to thread</button>}
        </li>
      ))}</ol> : <p className="workspace-comments-empty">{document.workspace?.lastCheckedAt ? 'No comments in this file yet.' : 'Comments appear after the first refresh.'}</p>}
      {document.workspace?.status !== 'deleted' && <form onSubmit={event => void submit(event)} className="workspace-comment-form">
        <label htmlFor={inputId}>{parentId ? 'Reply in Ambiguous' : 'Add a comment in Ambiguous'}</label>
        {parentId && <div className="workspace-reply-context"><span>Replying to {comments.find(comment => comment.id === parentId)?.authorName || 'this thread'}</span><button type="button" className="inline-link" disabled={posting} onClick={() => setParentId(undefined)}>Cancel reply</button></div>}
        <textarea id={inputId} value={content} onChange={event => { setContent(event.target.value); setPosted(false); }} rows={3} maxLength={4000} disabled={posting} placeholder="Add context, a correction, or feedback…" />
        <div className="workspace-comment-submit"><p>{meeting.phase === 'ended' ? 'Comments are saved in Ambiguous. Use Update drafts to act on this feedback.' : 'Comments are saved in Ambiguous and can guide Sidekick’s next update.'}</p><button className="button primary compact" type="submit" disabled={posting || !content.trim()}>{posting ? <LoaderCircle size={14} className="spin" /> : <MessageSquare size={14} />}Post comment to Ambiguous</button></div>
        {error && <p role="alert" className="workspace-inline-error">{error}</p>}
        {posted && <p role="status" className="workspace-comment-posted">Comment posted in Ambiguous.</p>}
      </form>}
    </section>
  );
}

export function WorkspaceFile({ meeting, document, targetId = document.id, refreshing, refreshError, onRefresh, onMeeting }: {
  meeting: Meeting; document: WorkDocument; targetId?: string; refreshing: boolean; refreshError: string | null;
  onRefresh: () => Promise<void>; onMeeting: (meeting: Meeting) => void;
}) {
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [action, setAction] = useState<'keep-workspace' | 'apply-draft' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const tabId = useId();
  const pending = document.pendingDraft;
  const reviewKey = pending && `${pending.id}:${document.workspace?.version ?? ''}`;
  const proposed = Boolean(pending && reviewed === reviewKey);
  const shown: WorkDocument = proposed && pending ? { ...document, ...pending, id: document.id, key: document.key } : document;
  const workspaceUrl = safeUrl(document.url);
  async function resolve(next: 'keep-workspace' | 'apply-draft') {
    if (!pending || !document.workspace?.version || action || next === 'apply-draft' && !proposed) return;
    setAction(next); setActionError(null);
    try { onMeeting(await api.resolveWorkspaceDraft(meeting.id, targetId, next, pending.id, document.workspace.version)); setReviewed(null); }
    catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not finish reviewing this draft.');
      if (error instanceof ApiError && error.status === 409) { setReviewed(null); await onRefresh(); }
    } finally { setAction(null); }
  }
  return (
    <div className="workspace-file">
      <div className="document-detail-meta">
        <span className="artifact-detail-format"><ArtifactIcon document={shown} size={15} />{artifactLabel(shown)}{artifactSize(shown) && <> · {artifactSize(shown)}</>}</span>
        <span className="status-pill">{shown.kind}</span><span>{proposed && pending ? `Prepared ${checkedTime(pending.createdAt)}` : `Version ${document.version}`}</span>
        <span className={`save-detail ${proposed ? 'local' : document.saveStatus}`}>{proposed ? 'Proposed draft · awaiting review' : document.saveStatus === 'saved' ? <><CheckCheck size={14} />Saved to Ambiguous AI</> : document.saveStatus === 'saving' ? 'Saving…' : document.saveStatus === 'failed' ? 'Workspace save failed' : 'Local draft'}</span>
      </div>
      {workspaceUrl && <div className="document-detail-actions"><a className="button primary compact" href={workspaceUrl} target="_blank" rel="noopener noreferrer">Open in Ambiguous<ArrowUpRight size={15} /></a></div>}
      <WorkspaceToolbar meeting={meeting} document={document} refreshing={refreshing} refreshError={refreshError} onRefresh={onRefresh} onMeeting={onMeeting} />
      {document.error && document.error !== pending?.reason && <div className="notice-bar warning">{document.error}</div>}
      {document.workspace?.notice && <div className={`notice-bar ${document.workspace.status === 'current' ? '' : 'warning'}`}>{document.workspace.notice}</div>}
      {document.workspace?.previewLimited && <div className="notice-bar warning">This preview includes the content Sidekick can read. Open in Ambiguous to see the complete file and layout.</div>}
      {pending && <div className="workspace-conflict">
        <h3><AlertCircle size={17} />A draft needs your review</h3>
        <p>{pending.reason || 'Workspace edits overlap with a proposed Sidekick draft. Choose which content to keep.'}</p>
        <div className="workspace-version-tabs" role="tablist" aria-label="Version to review" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const target = event.target as HTMLElement;
          if (target.getAttribute('role') !== 'tab') return;
          event.preventDefault();
          const next = event.key === 'Home' ? false : event.key === 'End' ? true : !proposed;
          setReviewed(next ? reviewKey! : null);
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-version="${next ? 'draft' : 'workspace'}"]`)?.focus();
        }}>
          <button type="button" role="tab" data-version="workspace" id={`${tabId}-workspace`} aria-controls={`${tabId}-content`} aria-selected={!proposed} tabIndex={proposed ? -1 : 0} onClick={() => setReviewed(null)}>Workspace version</button>
          <button type="button" role="tab" data-version="draft" id={`${tabId}-draft`} aria-controls={`${tabId}-content`} aria-selected={proposed} tabIndex={proposed ? 0 : -1} onClick={() => setReviewed(reviewKey!)}>Proposed draft</button>
        </div>
        {proposed && <p className="workspace-apply-explanation">Applying replaces overlapping text and values with this reviewed draft. Other workspace edits are kept.</p>}
        <div className="workspace-conflict-actions">
          <button type="button" className="button secondary compact" disabled={Boolean(action) || !document.workspace?.version} onClick={() => void resolve('keep-workspace')}>{action === 'keep-workspace' && <LoaderCircle size={13} className="spin" />}Keep workspace version</button>
        </div>
        {!document.workspace?.version && <p>Refresh from Ambiguous before choosing a version.</p>}
      </div>}
      {actionError && <p className="workspace-inline-error" role="alert">{actionError}</p>}
      <div id={pending ? `${tabId}-content` : undefined} role={pending ? 'tabpanel' : undefined} aria-labelledby={pending ? `${tabId}-${proposed ? 'draft' : 'workspace'}` : undefined}>
        {proposed && <h3 className="workspace-proposed-title">{shown.title}</h3>}
        <WorkspaceFileContent key={`${document.id}-${proposed ? pending?.id : 'workspace'}`} document={shown} />
      </div>
      {proposed && <div className="workspace-review-footer"><p>Apply this reviewed draft to the overlapping text and values in Ambiguous.</p><button type="button" className="button primary compact" disabled={Boolean(action) || refreshing || !document.workspace?.version || ['error', 'checking', 'deleted'].includes(document.workspace.status)} onClick={() => void resolve('apply-draft')}>{action === 'apply-draft' && <LoaderCircle size={13} className="spin" />}Apply reviewed draft</button></div>}
      <WorkspaceComments key={document.id} meeting={meeting} document={document} targetId={targetId} onMeeting={onMeeting} />
      {workspaceUrl && <div className="document-detail-footer"><span>{meeting.title}</span><a className="button primary compact" href={workspaceUrl} target="_blank" rel="noopener noreferrer">Open in Ambiguous<ArrowUpRight size={15} /></a></div>}
    </div>
  );
}
