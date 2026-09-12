import { createHash, randomUUID } from 'node:crypto';
import type { ArtifactContent, Meeting, WorkDocument, WorkspaceComment } from '../shared/types';
import { activity, meetingMarkdown } from './domain';
import { MeetingStore, type StoredMeeting } from './store';
import { AmbiguousProvider, type WorkspaceDocument } from './providers/ambiguous';
import { projectWorkspaceDocument } from './providers/ambiguous-content';

export type WorkspaceProvider = Pick<AmbiguousProvider, 'save'> & Partial<Pick<AmbiguousProvider, 'get' | 'listComments' | 'createComment'>>;
export type RefreshResult = { meeting: StoredMeeting; changed: boolean };
export const artifactContent = (document: ArtifactContent): ArtifactContent => ({
  title: document.title, kind: document.kind, content: document.content,
  format: document.format ?? 'document', presentation: document.presentation,
  spreadsheet: document.spreadsheet, status: document.status,
});
export function workspaceVersion(snapshot: WorkspaceDocument) {
  return createHash('sha256').update(JSON.stringify([snapshot.id, snapshot.title, snapshot.type, snapshot.content])).digest('hex');
}
const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 800) : 'The workspace could not be refreshed.';
const commentsKey = (comments: WorkspaceComment[] = []) => JSON.stringify([...comments].sort((a,b) => a.id.localeCompare(b.id)).map(({id,content,resolved,parentId,authorId}) => ({id,content,resolved,parentId,authorId})));
const conflict = (text: string) => Object.assign(new Error(text), {status:409});

/** Serializes workspace I/O, while allowing fresh reads during long model turns. */
export class WorkspaceSync {
  private locks = new Map<string, Promise<unknown>>();
  private refreshes = new Map<string, Promise<RefreshResult>>();
  private checked = new Map<string, number>();
  constructor(private store: MeetingStore, readonly provider: WorkspaceProvider = new AmbiguousProvider()) {}

  async exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.locks.set(id, next);
    try { return await next; }
    finally { if (this.locks.get(id) === next) this.locks.delete(id); }
  }

  record(meeting: StoredMeeting): WorkDocument | undefined {
    if (!meeting.recordExternalId) return meeting.recordDocument;
    meeting.recordDocument ??= {
      id: 'record', key: 'meeting-record', title: `${meeting.title} — meeting record`,
      kind: 'notes', format: 'document', content: meetingMarkdown(meeting),
      status: meeting.phase === 'ended' ? 'complete' : 'draft',
      saveStatus: meeting.recordSaveStatus, version: 1,
      updatedAt: meeting.endedAt ?? meeting.startedAt,
      externalId: meeting.recordExternalId, url: meeting.recordUrl,
    };
    return meeting.recordDocument;
  }
  target(meeting: StoredMeeting, documentId: string): WorkDocument {
    const doc = documentId === 'record' ? this.record(meeting) : meeting.documents.find(d => d.id === documentId);
    if (!doc) throw Object.assign(new Error('File not found.'), {status:404});
    return doc;
  }

  async refresh(id: string, options: { documentId?: string; force?: boolean } = {}): Promise<RefreshResult> {
    const meeting = this.store.get(id);
    if (meeting.mode === 'demo' || !this.provider.get) return {meeting, changed:false};
    const key = `${id}:${options.documentId ?? '*'}`;
    const running = this.refreshes.get(key);
    if (running) return running;
    if (!options.force && Date.now() - (this.checked.get(key) ?? 0) < 5000) return {meeting, changed:false};
    const work = this.exclusive(id, () => this.refreshUnlocked(meeting, options.documentId));
    this.refreshes.set(key, work);
    try { return await work; }
    finally { this.checked.set(key, Date.now()); this.refreshes.delete(key); }
  }

  private async refreshUnlocked(meeting: StoredMeeting, documentId?: string): Promise<RefreshResult> {
    const record = this.record(meeting);
    const targets = (documentId ? [this.target(meeting, documentId)] : [...meeting.documents, ...(record ? [record] : [])]).filter(d => d.externalId);
    if (!targets.length || !this.provider.get) return {meeting,changed:false};
    const previousStatuses = new Map(targets.map(doc => [doc.id, doc.workspace?.status]));
    for (const doc of targets) doc.workspace = {...doc.workspace, status: doc.pendingDraft ? 'conflict' : 'checking'};
    this.store.save(meeting);
    const changedTitles: string[] = [];
    const errors: string[] = [];
    // Limit provider pressure while keeping a multi-artifact refresh responsive.
    for (let start = 0; start < targets.length; start += 3) {
      const group = targets.slice(start,start + 3);
      await Promise.all(group.map(async doc => {
        const checkedAt = new Date().toISOString();
        const [result, commentsResult] = await Promise.allSettled([
          this.provider.get!(doc.externalId!),
          this.provider.listComments ? this.provider.listComments(doc.externalId!) : Promise.resolve(doc.workspace?.comments ?? []),
        ]);
        if (result.status === 'rejected') {
          const deleted = (result.reason as {status?:number})?.status === 404;
          if (deleted && previousStatuses.get(doc.id) !== 'deleted') changedTitles.push(doc.title);
          doc.workspace = {...doc.workspace, status:deleted ? 'deleted' : 'error', lastCheckedAt:checkedAt, notice:deleted ? 'This file is no longer available in Ambiguous. The last local copy is preserved.' : message(result.reason)};
          errors.push(`${doc.title}: ${doc.workspace.notice}`);
          return;
        }
        const snapshot = result.value;
        const prior = meeting.documentSnapshots?.[doc.id];
        const previousBody = prior?.content ?? (doc.id === 'record' ? meeting.recordLastContent : meeting.documentLastContents?.[doc.id]);
        const bodyChanged = previousBody === undefined || snapshot.content !== previousBody || snapshot.title !== (prior?.title ?? doc.title);
        if (bodyChanged) { meeting.documentHumanEdited ??= {}; meeting.documentHumanEdited[doc.id] = true; }
        const comments = commentsResult.status === 'fulfilled' ? commentsResult.value : doc.workspace?.comments;
        const feedbackChanged = commentsResult.status === 'fulfilled' && commentsKey(comments) !== commentsKey(doc.workspace?.comments);
        try {
          const projection = projectWorkspaceDocument(snapshot, artifactContent(doc));
          if (doc.pendingDraft) doc.pendingDraft.requiresReview = true;
          // Migrate any failed pre-sync draft without destroying its only local copy.
          if (!doc.pendingDraft && doc.saveStatus === 'failed' && previousBody && snapshot.content !== previousBody) {
            this.stage(meeting, doc, artifactContent(doc), artifactContent(doc), 'This earlier local draft was not saved. Review it alongside the workspace version.');
          }
          if (!prior || workspaceVersion(prior) !== workspaceVersion(snapshot)) {
            Object.assign(doc, artifactContent(projection));
            if (bodyChanged) doc.version++;
            doc.updatedAt = snapshot.updated_at ?? doc.updatedAt;
          }
          meeting.documentSnapshots ??= {};
          meeting.documentSnapshots[doc.id] = structuredClone(snapshot);
          doc.workspace = {
            status: doc.pendingDraft ? 'conflict' : 'current', lastCheckedAt:checkedAt,
            updatedAt:snapshot.updated_at ?? undefined, version:workspaceVersion(snapshot),
            previewLimited:projection.previewLimited, notice:projection.previewNotice,
            comments, commentsError:commentsResult.status === 'rejected' ? message(commentsResult.reason) : undefined,
          };
          if (!doc.pendingDraft) { doc.saveStatus = 'saved'; doc.error = undefined; }
          if (bodyChanged || feedbackChanged || previousStatuses.get(doc.id) === 'deleted') changedTitles.push(doc.title);
        } catch (error) {
          doc.workspace = {...doc.workspace,status:'error',lastCheckedAt:checkedAt,notice:message(error)};
          errors.push(`${doc.title}: ${message(error)}`);
        }
      }));
    }
    meeting.workspaceCheckedAt = new Date().toISOString();
    meeting.workspaceError = errors.length ? errors.join(' ').slice(0,1600) : undefined;
    if (changedTitles.length) {
      meeting.workspaceRevision = (meeting.workspaceRevision ?? 0) + 1;
      // Ended meetings update their views only; explicit action can request more AI work.
      if (meeting.phase !== 'ended') meeting.revision++;
      activity(meeting,'document','Workspace edits and feedback received',[...new Set(changedTitles)].join('; '));
    }
    this.store.save(meeting);
    return {meeting,changed:changedTitles.length > 0};
  }

  stage(meeting: StoredMeeting, doc: WorkDocument, proposed: ArtifactContent, source: ArtifactContent, reason?: string, requiresReview = true) {
    doc.pendingDraft = {...artifactContent(proposed), id:randomUUID(), createdAt:new Date().toISOString(), reason, requiresReview};
    meeting.pendingDraftSources ??= {};
    meeting.pendingDraftSources[doc.id] = structuredClone(artifactContent(source));
    this.store.save(meeting);
    return doc.pendingDraft.id;
  }

  acceptSaved(meeting: StoredMeeting, doc: WorkDocument, saved: WorkspaceDocument, proposed: ArtifactContent, attemptId?: string) {
    if (attemptId && doc.pendingDraft?.id !== attemptId) return false;
    const projection = this.provider.get ? projectWorkspaceDocument(saved, proposed) : undefined;
    Object.assign(doc, artifactContent(projection ?? proposed));
    doc.externalId = saved.id;
    const route = doc.format === 'presentation' ? 'slides' : doc.format === 'spreadsheet' ? 'sheets' : 'docs';
    doc.url = `https://app.ambiguous.ai/${route}/${encodeURIComponent(saved.id)}`;
    doc.version++;
    doc.updatedAt = saved.updated_at ?? new Date().toISOString();
    doc.saveStatus = 'saved';
    doc.error = undefined;
    delete doc.pendingDraft;
    if (meeting.pendingDraftSources) delete meeting.pendingDraftSources[doc.id];
    meeting.documentSnapshots ??= {};
    meeting.documentSnapshots[doc.id] = structuredClone(saved);
    meeting.documentLastContents ??= {};
    meeting.documentLastContents[doc.id] = saved.content!;
    doc.workspace = {...doc.workspace,status:'current',lastCheckedAt:new Date().toISOString(),updatedAt:saved.updated_at ?? undefined,version:workspaceVersion(saved),previewLimited:projection?.previewLimited,notice:projection?.previewNotice};
    if (doc.id === 'record') {
      meeting.recordExternalId = saved.id;
      meeting.recordUrl = doc.url;
      meeting.recordLastContent = saved.content!;
      meeting.recordSaveStatus = 'saved';
    }
    this.store.save(meeting);
    return true;
  }

  async addComment(id: string, documentId: string, content: string, parentId?: string): Promise<RefreshResult> {
    return this.exclusive(id, async () => {
      const meeting = this.store.get(id);
      const doc = this.target(meeting,documentId);
      if (meeting.mode === 'demo' || !doc.externalId || !this.provider.createComment) throw new Error('Save this file in Ambiguous before adding a comment.');
      await this.provider.createComment(doc.externalId,content,parentId);
      return this.refreshUnlocked(meeting,documentId);
    });
  }

  async resolve(id: string, documentId: string, input: {action:'keep-workspace'|'apply-draft';draftId:string;workspaceVersion:string}): Promise<RefreshResult> {
    return this.exclusive(id, async () => {
      const meeting = this.store.get(id);
      const doc = this.target(meeting,documentId);
      if (doc.pendingDraft?.id !== input.draftId) throw conflict('The proposed draft changed. Review the latest versions before continuing.');
      const refreshed = await this.refreshUnlocked(meeting,documentId);
      if (doc.workspace?.status === 'error' || doc.workspace?.status === 'deleted' || doc.workspace?.version !== input.workspaceVersion) throw conflict('The workspace file changed. Review the refreshed versions before continuing.');
      const snapshot = meeting.documentSnapshots?.[doc.id];
      const source = meeting.pendingDraftSources?.[doc.id];
      if (!snapshot || !source || !doc.pendingDraft) throw conflict('Refresh the file before reviewing this draft.');
      if (input.action === 'keep-workspace') {
        delete doc.pendingDraft;
        delete meeting.pendingDraftSources![doc.id];
        doc.saveStatus = 'saved'; doc.error = undefined;
        doc.workspace.status = 'current';
        if (doc.id === 'record') meeting.recordSaveStatus = 'saved';
        activity(meeting,'document','Workspace version kept',doc.title);
        this.store.save(meeting);
        return {meeting,changed:refreshed.changed};
      }
      const draft = structuredClone(doc.pendingDraft);
      try {
        const saved = await this.provider.save({id:doc.externalId,...artifactContent(draft),lastContent:snapshot.content!,lastTitle:snapshot.title,sourceProjection:source,overwriteConflicts:true});
        this.acceptSaved(meeting,doc,saved,draft,draft.id);
        meeting.workspaceRevision = (meeting.workspaceRevision ?? 0) + 1;
        if (meeting.phase !== 'ended') meeting.revision++;
        activity(meeting,'document','Reviewed draft applied in Ambiguous',doc.title);
        this.store.save(meeting);
        return {meeting,changed:true};
      } catch (error) {
        doc.error = message(error); doc.saveStatus = 'failed';
        if (doc.pendingDraft) doc.pendingDraft.reason = doc.error;
        if (doc.workspace) doc.workspace.status = 'conflict';
        this.store.save(meeting);
        throw error;
      }
    });
  }
}
