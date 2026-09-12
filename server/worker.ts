import { randomUUID } from "node:crypto";
import { parseAnalysis } from "../shared/schema";
import type { ArtifactContent, DocumentFormat, Source, WorkDocument } from "../shared/types";
import { activity, applyAnalysis, meetingMarkdown } from "./domain";
import { MeetingStore, publicMeeting, type StoredMeeting } from "./store";
import { AgentsProvider } from "./providers/agents";
import { ExaProvider } from "./providers/exa";
import { AmbiguousProvider, WorkspaceConflictError } from "./providers/ambiguous";
import { AGENT_INSTRUCTIONS_VERSION } from "./prompts";
import { WorkspaceSync, artifactContent, type WorkspaceProvider } from './workspace-sync';
import { WorkspaceMergeError } from './providers/ambiguous-content';
import type { WorkspaceDocument } from './providers/ambiguous';

function retainSession(meeting: StoredMeeting, sessionId: string) {
  if (meeting.agentSessionId && meeting.agentSessionId !== sessionId) {
    meeting.previousAgentSessionIds ??= [];
    if (!meeting.previousAgentSessionIds.includes(meeting.agentSessionId))
      meeting.previousAgentSessionIds.push(meeting.agentSessionId);
  }
  meeting.agentSessionId = sessionId;
  meeting.agentInstructionsVersion = AGENT_INSTRUCTIONS_VERSION;
}

type Providers = {
  agents: Pick<AgentsProvider, "analyze">;
  exa: Pick<ExaProvider, "search">;
  workspace: WorkspaceProvider;
};
export class MeetingWorker {
  private running = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly workspaceSync: WorkspaceSync;
  constructor(
    private store: MeetingStore,
    private providers: Providers = {
      agents: new AgentsProvider(),
      exa: new ExaProvider(),
      workspace: new AmbiguousProvider(),
    },
  ) { this.workspaceSync = new WorkspaceSync(store, providers.workspace); }

  async refreshWorkspace(id: string, options: {documentId?:string;force?:boolean} = {}) {
    const result = await this.workspaceSync.refresh(id, options);
    if (result.changed && result.meeting.phase === 'active') this.schedule(id);
    return result.meeting;
  }
  async addWorkspaceComment(id: string, documentId: string, content: string, parentId?: string) {
    const result = await this.workspaceSync.addComment(id,documentId,content,parentId);
    if (result.changed && result.meeting.phase === 'active') this.schedule(id);
    return result.meeting;
  }
  async resolveWorkspaceDraft(id: string, documentId: string, input: {action:'keep-workspace'|'apply-draft';draftId:string;workspaceVersion:string}) {
    const result = await this.workspaceSync.resolve(id,documentId,input);
    if (result.changed && result.meeting.phase === 'active') this.schedule(id);
    return result.meeting;
  }
  updateFromWorkspace(id: string) {
    const meeting = this.store.get(id);
    if (meeting.mode === 'demo') throw new Error('Workspace feedback is available for live meetings.');
    if (meeting.phase === 'ended') meeting.phase = 'closing';
    meeting.revision++;
    meeting.error = undefined;
    activity(meeting,'thinking','Updating drafts from workspace feedback');
    this.store.save(meeting);
    this.schedule(id,true);
    return meeting;
  }
  schedule(id: string, immediately = false) {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(
        () => {
          this.timers.delete(id);
          void this.run(id);
        },
        immediately ? 0 : 3500,
      ),
    );
  }
  async run(id: string): Promise<void> {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const existing = this.running.get(id);
    if (existing) return existing;
    const task = this.process(id).finally(() => this.running.delete(id));
    this.running.set(id, task);
    return task;
  }
  private async process(id: string) {
    const meeting = this.store.get(id);
    if (meeting.mode === "demo" || meeting.phase === "ended") return;
    meeting.working = true;
    meeting.error = undefined;
    this.store.save(meeting);
    try {
      // One worker per meeting serializes workspace writes. New transcript revisions
      // invalidate pending model output before any document mutation begins.
      do {
        await this.workspaceSync.refresh(id, {force:true});
        const revision = meeting.revision;
        const workspaceRevision = meeting.workspaceRevision ?? 0;
        const closing = meeting.phase === "closing";
        const sources = new Map(meeting.documents.map(doc => [doc.id, {
          projection: structuredClone(artifactContent(doc)),
          snapshot: structuredClone(meeting.documentSnapshots?.[doc.id]),
        }]));
        const transcript = meeting.transcript
          .map(
            (t) =>
              `${t.role === "user" ? "PARTICIPANT" : "SIDEKICK"}: ${t.text}`,
          )
          .join("\n");
        if (!transcript.trim()) {
          meeting.summary = "No conversation was recorded.";
          if (closing) {
            await this.publishRecord(meeting, true);
            meeting.phase = "ended";
            meeting.endedAt = new Date().toISOString();
          }
          meeting.processedRevision = revision;
          break;
        }
        activity(
          meeting,
          "thinking",
          closing
            ? "Preparing the meeting record"
            : "Making sense of the discussion",
        );
        this.store.save(meeting);
        const input = {
          // Instructions and model defaults are configured at creation. A pre-upgrade
          // meeting starts one new session with its entire transcript/state;
          // native resource identities and the old session ID are retained.
          sessionId:
            meeting.agentInstructionsVersion === AGENT_INSTRUCTIONS_VERSION
              ? meeting.agentSessionId
              : undefined,
          transcript,
          currentState: structuredClone(publicMeeting(meeting)),
          closing,
        };
        let result = await this.providers.agents.analyze(input);
        retainSession(meeting, result.sessionId);
        this.store.save(meeting);
        if (!closing && meeting.phase === "closing") continue;
        if ((meeting.workspaceRevision ?? 0) !== workspaceRevision) continue;
        let analysis = parseAnalysis(result.text);
        const researchResults: { query: string; sources: Source[] }[] = [];
        const researchErrors: string[] = [];
        // Closing never starts another investigation. Existing saved findings are retained.
        if (!closing) {
          const queries = [...new Set(analysis.researchQueries)].slice(0, 2);
          for (const query of queries)
            activity(meeting, "research", "Researching with Exa", query);
          this.store.save(meeting);
          const results = await Promise.allSettled(
            queries.map(async (query) => ({
              query,
              sources: await this.providers.exa.search(query),
            })),
          );
          for (let index = 0; index < results.length; index++) {
            const value = results[index];
            if (value.status === "fulfilled") {
              researchResults.push(value.value);
              if (!value.value.sources.length)
                researchErrors.push(
                  `No sources returned for: ${queries[index]}`,
                );
              activity(
                meeting,
                "research",
                `${value.value.sources.length} sources retrieved`,
                queries[index],
              );
            } else {
              const message = safeError(value.reason);
              researchErrors.push(message);
              activity(meeting, "error", "Research could not finish", message);
            }
          }
          // Closing can arrive during a search. Preserve its completed evidence before
          // switching to handover so bounded work is not lost or repeated.
          const retrieved = new Map(
            meeting.sources.map((source) => [source.url, source]),
          );
          for (const result of researchResults)
            for (const source of result.sources)
              retrieved.set(source.url, source);
          meeting.sources = [...retrieved.values()];
          if (researchErrors.length) meeting.error = researchErrors.join(" ");
          this.store.save(meeting);
          if (meeting.phase === "closing") continue;
          if (queries.length) {
            result = await this.providers.agents.analyze({
              sessionId: meeting.agentSessionId,
              transcript,
              currentState: {
                ...structuredClone(publicMeeting(meeting)),
                researchResults,
                researchErrors,
                instruction:
                  "Incorporate these actual research outcomes into the documents now. Do not request another research round. Label unverified assumptions and cite only actual retrieved URLs.",
              },
              closing,
            });
            retainSession(meeting, result.sessionId);
            if (this.store.get(id).phase === "closing") continue;
            if ((meeting.workspaceRevision ?? 0) !== workspaceRevision) continue;
            analysis = parseAnalysis(result.text);
          }
        }
        // Catch native edits even when nobody currently has a Sidekick tab open.
        await this.workspaceSync.refresh(id, {force:true});
        if ((meeting.workspaceRevision ?? 0) !== workspaceRevision) continue;
        const stale = meeting.revision !== revision;
        if (stale) {
          if (meeting.title === "Untitled conversation")
            meeting.title = analysis.title;
          activity(
            meeting,
            "system",
            "Drafting while the conversation continues",
            "This draft reflects an earlier part of the discussion. Sidekick will review the latest messages next.",
          );
        }
        const sourceMap = new Map(meeting.sources.map((s) => [s.url, s]));
        for (const r of researchResults)
          for (const source of r.sources) sourceMap.set(source.url, source);
        meeting.sources = [...sourceMap.values()];
        if (researchErrors.length) meeting.error = researchErrors.join(" ");
        for (const draft of analysis.documents) {
          if (!closing && meeting.phase === "closing") break;
          if ((meeting.workspaceRevision ?? 0) !== workspaceRevision) break;
          if (stale) {
            draft.status = "draft";
            // Native slides and sheets do not render the Markdown overview, so
            // identify an older snapshot in the workspace title as well.
            if (draft.format && draft.format !== "document")
              draft.title = `${draft.title} (earlier draft)`;
            draft.content = `> Working draft from an earlier conversation snapshot (revision ${revision}). The discussion has continued; new constraints or corrections may not yet be reflected.\n\n${draft.content}`;
          }
          let document = meeting.documents.find((d) => d.key === draft.key);
          const format = draft.format ?? "document";
          if (document && (document.format ?? "document") !== format) {
            // A format change creates a separate native resource. Never convert
            // an existing shared document or lose its canonical edit snapshot.
            draft.key = `${draft.key.slice(0, 80)}:${format}`;
            document = meeting.documents.find((d) => d.key === draft.key);
            if (document && (document.format ?? "document") !== format)
              throw new Error(
                "This work key belongs to another format. Use a separate key for the new artifact.",
              );
          }
          if (
            document?.content === draft.content &&
            document.title === draft.title &&
            document.kind === draft.kind &&
            (document.format ?? "document") === format &&
            JSON.stringify(document.presentation) ===
              JSON.stringify(draft.presentation) &&
            JSON.stringify(document.spreadsheet) ===
              JSON.stringify(draft.spreadsheet) &&
            document.status === draft.status &&
            document.saveStatus === "saved" && !document.pendingDraft
          )
            continue;
          if (!document) {
            document = {
              ...draft,
              id: randomUUID(),
              version: 0,
              saveStatus: "local",
              updatedAt: new Date().toISOString(),
            };
            meeting.documents.push(document);
          }
          const source = sources.get(document.id);
          await this.publishDocument(meeting, document, {...draft,format}, source?.projection ?? artifactContent(document), source?.snapshot, workspaceRevision);
        }
        if ((meeting.workspaceRevision ?? 0) !== workspaceRevision) continue;
        if (meeting.revision !== revision) {
          meeting.processedRevision = revision;
          this.store.save(meeting);
          continue;
        }
        applyAnalysis(meeting, analysis);
        // Closing preserves unfinished documents rather than quietly upgrading them.
        if (closing)
          for (const document of meeting.documents)
            if (document.status === "draft") document.status = "incomplete";
        await this.publishRecord(meeting, closing);
        if ((meeting.workspaceRevision ?? 0) !== workspaceRevision || meeting.revision !== revision) continue;
        if (closing) { meeting.phase = 'ended'; meeting.endedAt = new Date().toISOString(); }
        meeting.processedRevision = revision;
        this.store.save(meeting);
      } while (
        meeting.processedRevision < meeting.revision &&
        meeting.phase !== "ended"
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "sessionId" in error &&
        typeof error.sessionId === "string"
      )
        retainSession(meeting, error.sessionId);
      meeting.error = safeError(error);
      activity(
        meeting,
        "error",
        "Sidekick could not finish an update",
        meeting.error,
      );
      if (meeting.phase === "closing") {
        for (const doc of meeting.documents)
          if (doc.status === "draft") doc.status = "incomplete";
        await this.publishRecord(meeting, true);
        meeting.phase = "ended";
        meeting.endedAt = new Date().toISOString();
      }
    } finally {
      meeting.working = false;
      this.store.save(meeting);
    }
  }
  private async publishDocument(
    meeting: StoredMeeting,
    document: WorkDocument,
    proposed: ArtifactContent = artifactContent(document),
    source: ArtifactContent = artifactContent(document),
    snapshot?: WorkspaceDocument,
    expectedWorkspaceRevision = meeting.workspaceRevision ?? 0,
    requireReview = false,
  ) {
    let failed = false;
    await this.workspaceSync.exclusive(meeting.id, async () => {
      if ((meeting.workspaceRevision ?? 0) !== expectedWorkspaceRevision) return;
      const alreadyConflicted = Boolean(document.pendingDraft && document.pendingDraft.requiresReview !== false);
      const attemptId = this.workspaceSync.stage(meeting, document, proposed, source, undefined, requireReview || alreadyConflicted);
      if (requireReview || alreadyConflicted) {
        document.pendingDraft!.reason = 'Workspace edits are preserved. Review the proposed draft before applying it.';
        document.workspace = {...document.workspace, status:'conflict'};
        document.saveStatus = 'failed';
        if (document.id === 'record') meeting.recordSaveStatus = 'failed';
        this.store.save(meeting);
        return;
      }
      document.saveStatus = 'saving';
      if (document.id === 'record') meeting.recordSaveStatus = 'saving';
      this.store.save(meeting);
      try {
        const saved = await this.providers.workspace.save({
          id: document.externalId,
          ...artifactContent(proposed),
          lastContent: snapshot?.content ?? (document.id === 'record' ? meeting.recordLastContent : meeting.documentLastContents?.[document.id]),
          lastTitle: snapshot?.title,
          // Once a collaborator has edited a file, retain its native structure on
          // every future save, including after a successful intervening AI edit.
          sourceProjection: meeting.documentHumanEdited?.[document.id] ? source : undefined,
          onCreated: (id) => {
            document.externalId = id;
            document.url = workspaceDocumentUrl(id, document.format);
            if (document.id === 'record') meeting.recordExternalId = id;
            this.store.save(meeting);
          },
          onWritten: (written) => {
            if (typeof written.content === 'string') {
              meeting.documentLastContents ??= {};
              meeting.documentLastContents[document.id] = written.content;
              if (document.id === 'record') meeting.recordLastContent = written.content;
              this.store.save(meeting);
            }
          },
        });
        this.workspaceSync.acceptSaved(meeting, document, saved, proposed, attemptId);
        activity(meeting, 'document', document.id === 'record'
          ? 'Meeting record saved in Ambiguous AI'
          : `${formatLabel(document.format)} ${document.version === 1 ? 'saved' : 'updated'} in Ambiguous AI`, document.title);
      } catch (error) {
        failed = true;
        document.saveStatus = 'failed';
        document.error = safeError(error);
        if (document.pendingDraft?.id === attemptId) {
          document.pendingDraft.reason = document.error;
          if (error instanceof WorkspaceConflictError || error instanceof WorkspaceMergeError) document.pendingDraft.requiresReview = true;
        }
        // A fresh read below imports the canonical copy after a concurrent edit.
        document.workspace = {...document.workspace, status:'error', notice:document.error};
        if (document.id === 'record') meeting.recordSaveStatus = 'failed';
        activity(meeting, 'error', 'Workspace save needs attention', `${document.title}: ${document.error}`);
      }
      this.store.save(meeting);
    });
    if (failed && document.externalId) await this.workspaceSync.refresh(meeting.id, {documentId:document.id,force:true});
  }
  private async publishRecord(meeting: StoredMeeting, closing = meeting.phase === 'ended') {
    const recordState = closing ? {...meeting, phase:'ended' as const, endedAt:meeting.endedAt ?? new Date().toISOString()} : meeting;
    const proposed: ArtifactContent = {
      title: `${meeting.title} — meeting record`, kind:'notes', format:'document',
      content:meetingMarkdown(recordState), status:closing ? 'complete' : 'draft',
    };
    const document = this.workspaceSync.record(meeting) ?? {
      ...proposed,id:'record',key:'meeting-record',version:0,saveStatus:'local' as const,updatedAt:new Date().toISOString(),
    };
    meeting.recordDocument = document;
    const snapshot = structuredClone(meeting.documentSnapshots?.record);
    const source = structuredClone(artifactContent(document));
    // The generated record derives from transcript evidence. Native annotations
    // are separate and must not disappear when that generated body evolves.
    const humanEdited = Boolean(meeting.documentHumanEdited?.record);
    if (humanEdited) proposed.title = document.title;
    if (source.content === proposed.content && source.title === proposed.title && document.saveStatus === 'saved' && !document.pendingDraft) return;
    await this.publishDocument(meeting, document, proposed, source, snapshot, meeting.workspaceRevision ?? 0, humanEdited);
  }
  async delegate(
    id: string,
    delegationId: string,
  ): Promise<{ text: string; revision: number; speak?: boolean }> {
    const meeting = this.store.get(id);
    const cached = meeting.delegationResults?.[delegationId];
    if (cached) return cached;
    if (
      !meeting.transcript.some(
        (t) => t.role === "user" && t.text.trim().length > 15,
      )
    )
      return {
        text: "The request is not clear in the available transcript yet. Ask one brief clarification before starting work.",
        revision: meeting.revision,
        speak: true,
      };
    const revision = meeting.revision;
    await this.run(id);
    const current = this.store.get(id);
    const saved = current.documents
      .filter((d) => d.saveStatus === "saved")
      .map((d) => d.title);
    const errors = [
      current.error,
      ...current.documents
        .filter((d) => d.saveStatus === "failed")
        .map((d) => `${d.title}: ${d.error || "workspace save failed"}`),
    ]
      .filter(Boolean)
      .join("; ");
    const result = {
      revision: current.revision,
      text:
        revision !== current.revision
          ? "The discussion changed while I worked. Consult the updated workspace; do not announce older conclusions."
          : errors
            ? `Work is incomplete: ${errors}. ${saved.length ? `Verified saved documents: ${saved.join(", ")}.` : "No document save is confirmed."}`
            : `Current direction: ${current.summary.slice(0, 650)}. ${saved.length ? `Verified saved in Ambiguous AI: ${saved.join(", ")}.` : "No document save is confirmed yet."} ${current.recordSaveStatus === "saved" ? "The meeting record is also saved." : ""} ${
                current.ambiguities.length
                  ? `Unresolved: ${current.ambiguities
                      .map((i) => i.text)
                      .join("; ")
                      .slice(0, 500)}`
                  : ""
              }`,
    };
    const contribution = current.spokenResponse?.trim();
    if (contribution && !errors && revision === current.revision)
      result.text += ` Useful contribution: ${contribution.slice(0, 700)}`;
    const response = {
      ...result,
      text: result.text.slice(0, 2400),
      speak: revision === current.revision && Boolean(contribution || errors),
    };
    current.delegationResults ??= {};
    current.delegationResults[delegationId] = response;
    this.store.save(current);
    return response;
  }
}
export function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 800)
    : "The operation failed. Completed work has been preserved.";
}
export function formatLabel(format: DocumentFormat = "document") {
  return format === "presentation"
    ? "Presentation"
    : format === "spreadsheet"
      ? "Spreadsheet"
      : "Document";
}
export function workspaceDocumentUrl(
  id: string,
  format: DocumentFormat = "document",
) {
  const path =
    format === "presentation"
      ? "slides"
      : format === "spreadsheet"
        ? "sheets"
        : "docs";
  return `https://app.ambiguous.ai/${path}/${encodeURIComponent(id)}`;
}
