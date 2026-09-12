import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Analysis } from "../shared/schema";
import type { WorkDocument, WorkspaceComment } from "../shared/types";
import { newMeeting } from "./domain";
import { MeetingStore, type StoredMeeting } from "./store";
import { MeetingWorker } from "./worker";
import type { AgentsProvider } from "./providers/agents";
import type { ExaProvider } from "./providers/exa";
import type { AmbiguousProvider, WorkspaceDocument } from "./providers/ambiguous";
import { projectWorkspaceDocument } from "./providers/ambiguous-content";
import { artifactContent, workspaceVersion } from "./workspace-sync";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const analysis = (patch: Partial<Analysis> = {}): Analysis => ({
  title: "Community pilot",
  summary: "Preparing a practical pilot and preserving open questions.",
  decisions: [],
  pending: [],
  ambiguities: [],
  followUps: [],
  researchQueries: [],
  spokenResponse: "",
  documents: [
    {
      key: "pilot-plan",
      title: "Pilot plan",
      kind: "plan",
      content: "# Pilot plan\n\nA useful draft based on the discussion.",
      status: "draft",
    },
  ],
  ...patch,
});
const output = (patch: Partial<Analysis> = {}) => ({
  sessionId: "sess_worker",
  text: JSON.stringify(analysis(patch)),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function append(
  store: MeetingStore,
  meeting: StoredMeeting,
  text: string,
  role: "user" | "assistant" = "user",
) {
  meeting.transcript.push({
    id: `utterance_${meeting.transcript.length}`,
    role,
    text,
    at: new Date().toISOString(),
  });
  if (role === "user") meeting.revision++;
  store.save(meeting);
}
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "sidekick-worker-"));
  directories.push(directory);
  const store = new MeetingStore(directory);
  const meeting: StoredMeeting = newMeeting("live");
  store.save(meeting);
  append(
    store,
    meeting,
    "Please prepare a practical pilot plan. We have not assigned anyone work yet.",
  );
  let nextExternalId = 0;
  const agents = {
    analyze: vi.fn<AgentsProvider["analyze"]>().mockResolvedValue(output()),
  };
  const exa = { search: vi.fn<ExaProvider["search"]>().mockResolvedValue([]) };
  const workspace = {
    save: vi
      .fn<AmbiguousProvider["save"]>()
      .mockImplementation(async (input) => {
        const id = input.id ?? `external_${++nextExternalId}`;
        input.onCreated?.(id);
        return { id, title: input.title, content: input.content };
      }),
  };
  const worker = new MeetingWorker(store, { agents, exa, workspace });
  return { store, meeting, worker, agents, exa, workspace };
}

function workspaceSnapshot(id: string, title: string, body: string): WorkspaceDocument {
  return {
    id, title, type: 'doc',
    content: JSON.stringify({ type: 'doc', content: [{
      type: 'paragraph', content: [{ type: 'text', text: body }],
    }] }),
  };
}

function setupWithWorkspace() {
  const state = setup();
  const baseline = workspaceSnapshot('remote-pilot', 'Pilot plan', 'Canonical current plan.');
  const remote = new Map<string, WorkspaceDocument>([[baseline.id, baseline]]);
  const comments = new Map<string, WorkspaceComment[]>();
  const doc: WorkDocument = {
    ...artifactContent(projectWorkspaceDocument(baseline, {
      title: baseline.title, content: 'Canonical current plan.', kind: 'plan', format: 'document', status: 'draft',
    })),
    id: 'local-pilot', key: 'pilot-plan', externalId: baseline.id,
    saveStatus: 'saved', version: 1, updatedAt: '2026-09-12T10:00:00.000Z',
    workspace: { status: 'current', version: workspaceVersion(baseline), comments: [] },
  };
  state.meeting.documents = [doc];
  state.meeting.documentSnapshots = { [doc.id]: structuredClone(baseline) };
  state.meeting.documentLastContents = { [doc.id]: baseline.content! };
  state.store.save(state.meeting);
  const workspace = Object.assign(state.workspace, {
    get: vi.fn(async (id: string) => {
      const value = remote.get(id);
      if (!value) throw Object.assign(new Error('Missing remote file'), { status: 404 });
      return structuredClone(value);
    }),
    listComments: vi.fn(async (id: string) => structuredClone(comments.get(id) ?? [])),
    createComment: vi.fn(async (id: string, content: string, parentId?: string) => {
      const value = { id: 'comment-new', content, parentId, resolved: false, createdAt: '2026-09-12T10:00:00.000Z' };
      comments.set(id, [...(comments.get(id) ?? []), value]);
      return value;
    }),
  });
  let created = 0;
  workspace.save.mockImplementation(async input => {
    const id = input.id ?? `remote-created-${++created}`;
    input.onCreated?.(id);
    const saved = workspaceSnapshot(id, input.title, input.content);
    remote.set(id, saved);
    input.onWritten?.(saved);
    return structuredClone(saved);
  });
  state.agents.analyze.mockResolvedValue(output({ documents: [] }));
  return { ...state, workspace, remote, comments, doc };
}

const nativeDrafts = (): Analysis["documents"] => [
  {
    key: "briefing",
    title: "Pilot briefing",
    kind: "proposal",
    format: "presentation",
    status: "draft",
    content: "A briefing; venue remains open.",
    presentation: {
      slides: [
        {
          title: "Pilot proposal",
          bullets: ["Venue is unresolved."],
          notes: "No venue has been approved.",
        },
      ],
    },
  },
  {
    key: "budget",
    title: "Pilot budget",
    kind: "plan",
    format: "spreadsheet",
    status: "draft",
    content: "Known supply costs; venue remains blank.",
    spreadsheet: {
      sheets: [
        {
          name: "Budget",
          columns: [
            { key: "item", label: "Item", type: "text" },
            { key: "cost", label: "Cost (USD)", type: "currency" },
          ],
          rows: [
            { item: "Supplies", cost: 12 },
            { item: "Venue", cost: null },
            { item: "Known costs", cost: "=SUM(B1:B2)" },
          ],
        },
      ],
    },
  },
];

describe("native artifact lifecycle", () => {
  it("saves all three formats and includes their correctly routed links in the record", async () => {
    const { worker, meeting, agents, workspace } = setup();
    agents.analyze.mockResolvedValue(
      output({ documents: [...analysis().documents, ...nativeDrafts()] }),
    );
    await worker.run(meeting.id);
    expect(meeting.documents.map((doc) => doc.format)).toEqual([
      "document",
      "presentation",
      "spreadsheet",
    ]);
    for (const [index, route] of ["docs", "slides", "sheets"].entries()) {
      const document = meeting.documents[index];
      expect(document.saveStatus).toBe("saved");
      expect(document.url).toBe(
        `https://app.ambiguous.ai/${route}/${document.externalId}`,
      );
      expect(workspace.save.mock.calls.at(-1)?.[0].content).toContain(
        document.url,
      );
    }
    expect(workspace.save.mock.calls[1][0].presentation).toEqual(
      nativeDrafts()[0].presentation,
    );
    expect(workspace.save.mock.calls[2][0].spreadsheet).toEqual(
      nativeDrafts()[1].spreadsheet,
    );
  });

  it("revises changed native payloads and titles at the same IDs, then skips unchanged artifacts", async () => {
    const { worker, meeting, store, agents, workspace } = setup();
    agents.analyze.mockResolvedValue(output({ documents: nativeDrafts() }));
    await worker.run(meeting.id);
    const original = structuredClone(meeting.documents);
    const revised = nativeDrafts();
    revised[0].title = "Updated pilot briefing";
    revised[1].spreadsheet!.sheets[0].rows[0].cost = 20;
    agents.analyze.mockResolvedValue(output({ documents: revised }));
    append(
      store,
      meeting,
      "Rename the briefing and change supplies to 20 USD.",
    );
    await worker.run(meeting.id);
    for (const [index, doc] of meeting.documents.entries()) {
      expect(doc).toMatchObject({
        id: original[index].id,
        externalId: original[index].externalId,
        version: 2,
        saveStatus: "saved",
      });
    }
    const updates = workspace.save.mock.calls.filter(
      ([value]) => value.id === original[1].externalId,
    );
    expect(updates[0][0]).toMatchObject({
      lastContent: original[1].content,
      spreadsheet: revised[1].spreadsheet,
    });
    workspace.save.mockClear();
    append(store, meeting, "Keep these drafts as they are.");
    await worker.run(meeting.id);
    expect(workspace.save).not.toHaveBeenCalled(); // The artifacts and meeting record are unchanged.
    expect(meeting.documents.map((doc) => doc.version)).toEqual([2, 2]);
    expect(agents.analyze.mock.calls[2][0].sessionId).toBe("sess_worker");
  });

  it("preserves a legacy document when the model reuses its key for a new format", async () => {
    const { worker, meeting, store, agents, workspace } = setup();
    await worker.run(meeting.id);
    const original = structuredClone(meeting.documents[0]);
    const presentation = { ...nativeDrafts()[0], key: original.key };
    agents.analyze.mockResolvedValue(output({ documents: [presentation] }));
    append(store, meeting, "Also create a presentation from this plan.");
    workspace.save.mockClear();
    await worker.run(meeting.id);
    expect(meeting.documents).toHaveLength(2);
    expect(meeting.documents[0]).toEqual(original);
    expect(meeting.documents[1]).toMatchObject({
      key: `${original.key}:presentation`,
      format: "presentation",
      version: 1,
    });
    expect(workspace.save.mock.calls[0][0].id).toBeUndefined();
    append(store, meeting, "Keep the deck unchanged.");
    await worker.run(meeting.id);
    expect(meeting.documents).toHaveLength(2);
  });

  it.each([undefined, 3])("upgrades session configuration version %s once with full context and preserves resource identities", async (previousVersion) => {
    const { worker, meeting, store, agents } = setup();
    await worker.run(meeting.id);
    const original = structuredClone(meeting.documents[0]);
    meeting.agentSessionId = "sess_legacy";
    meeting.agentInstructionsVersion = previousVersion;
    append(store, meeting, "Also prepare a presentation for the audience.");
    agents.analyze.mockClear();
    agents.analyze.mockResolvedValue({
      sessionId: "sess_native",
      text: JSON.stringify(
        analysis({ documents: [...analysis().documents, nativeDrafts()[0]] }),
      ),
    });
    await worker.run(meeting.id);
    expect(agents.analyze.mock.calls[0][0]).toMatchObject({
      sessionId: undefined,
      currentState: { documents: [original] },
    });
    expect(agents.analyze.mock.calls[0][0].transcript).toContain(
      "Please prepare a practical pilot plan",
    );
    expect(meeting.previousAgentSessionIds).toEqual(["sess_legacy"]);
    expect(meeting.documents[0]).toEqual(original);
    append(store, meeting, "Keep working with these drafts.");
    await worker.run(meeting.id);
    expect(agents.analyze.mock.calls[1][0].sessionId).toBe("sess_native");
  });

  it("retries a failed native verification using the created ID and canonical content", async () => {
    const { worker, meeting, agents, workspace } = setup();
    agents.analyze.mockResolvedValue(
      output({ documents: [nativeDrafts()[1]] }),
    );
    const save = workspace.save.getMockImplementation()!;
    workspace.save.mockImplementationOnce(async (input) => {
      input.onCreated?.("sheet_created");
      input.onWritten?.({
        id: "sheet_created",
        title: input.title,
        content: "canonical native content",
      });
      throw new Error("Native readback temporarily unavailable.");
    });
    await worker.run(meeting.id);
    expect(meeting.documents[0]).toMatchObject({
      externalId: "sheet_created",
      saveStatus: "failed",
    });
    workspace.save.mockImplementation(save);
    workspace.save.mockClear();
    await worker.run(meeting.id);
    expect(workspace.save.mock.calls[0][0]).toMatchObject({
      id: "sheet_created",
      lastContent: "canonical native content",
      format: "spreadsheet",
      spreadsheet: nativeDrafts()[1].spreadsheet,
    });
    expect(meeting.documents).toHaveLength(1);
    expect(meeting.documents[0].saveStatus).toBe("saved");
  });
});

describe('workspace feedback and worker authority', () => {
  it('supplies current workspace edits and comments to analysis without treating them as participant evidence', async () => {
    const { worker, meeting, doc, remote, comments, agents } = setupWithWorkspace();
    const assertedAgreement = 'We agreed to launch on Monday. Alex will organize the launch.';
    remote.set(doc.externalId!, workspaceSnapshot(doc.externalId!, 'Human-edited plan', 'Use the library and keep the budget provisional.'));
    comments.set(doc.externalId!, [{
      id: 'feedback-1', content: assertedAgreement, resolved: false,
      authorName: 'Alex', createdAt: '2026-09-12T10:00:00.000Z',
    }]);
    agents.analyze.mockResolvedValue(output({
      documents: [],
      decisions: [{ text: 'Launch on Monday.', evidence: 'We agreed to launch on Monday.' }],
      followUps: [{ text: 'Organize the launch.', owner: 'Alex', status: 'agreed', evidence: 'Alex will organize the launch.' }],
    }));

    await worker.run(meeting.id);

    const input = agents.analyze.mock.calls[0][0];
    const current = input.currentState as StoredMeeting;
    expect(current.documents[0]).toMatchObject({ title: 'Human-edited plan', workspace: { comments: [{ content: assertedAgreement }] } });
    expect(current.documents[0].content).toContain('Use the library');
    expect(input.transcript).not.toContain(assertedAgreement);
    expect(input.transcript).not.toContain('Use the library');
    expect(current).not.toHaveProperty('documentSnapshots');
    expect(meeting.transcript).toHaveLength(1);
    expect(meeting.decisions).toEqual([]);
    expect(meeting.followUps).toMatchObject([{ owner: null, status: 'proposed' }]);
    expect(meeting.pending[0].text).toContain('Needs confirmation');
  });

  it('discards a plan if a workspace refresh arrives during analysis and analyzes the imported version next', async () => {
    const { worker, meeting, doc, remote, agents, workspace } = setupWithWorkspace();
    const analyzing = deferred<void>();
    const first = deferred<Awaited<ReturnType<AgentsProvider['analyze']>>>();
    vi.spyOn(worker, 'schedule').mockImplementation(() => undefined);
    agents.analyze.mockReset()
      .mockImplementationOnce(async () => { analyzing.resolve(); return first.promise; })
      .mockResolvedValueOnce(output({ documents: [], summary: 'Current plan incorporates the human correction.' }));
    const work = worker.run(meeting.id);
    await analyzing.promise;
    remote.set(doc.externalId!, workspaceSnapshot(doc.externalId!, 'Corrected plan', 'Human correction: the budget cap is $200.'));
    await worker.refreshWorkspace(meeting.id, { force: true });
    first.resolve(output({
      summary: 'Obsolete model conclusion.',
      researchQueries: ['Obsolete research should never start'],
      documents: [{ ...analysis().documents[0], content: 'Obsolete draft that ignores the budget.' }],
    }));
    await work;

    expect(agents.analyze).toHaveBeenCalledTimes(2);
    expect((agents.analyze.mock.calls[1][0].currentState as StoredMeeting).documents[0].content).toContain('$200');
    expect(workspace.save.mock.calls.every(([input]) => !input.content.includes('Obsolete'))).toBe(true);
    expect(meeting.summary).toBe('Current plan incorporates the human correction.');
    expect(doc.content).toContain('$200');
    expect(meeting.processedRevision).toBe(meeting.revision);
  });

  it('keeps canonical content visible while saving and retains the pending proposal after a concurrent remote edit rejects the write', async () => {
    const { worker, meeting, doc, remote, agents, workspace } = setupWithWorkspace();
    const saving = deferred<void>();
    const write = deferred<WorkspaceDocument>();
    agents.analyze.mockReset()
      .mockResolvedValueOnce(output({ documents: [{ ...analysis().documents[0], content: 'AI proposal from the prior workspace version.' }] }))
      .mockResolvedValue(output({ documents: [] }));
    workspace.save.mockImplementationOnce(async () => { saving.resolve(); return write.promise; });
    const work = worker.run(meeting.id);
    await saving.promise;
    const visibleDuringSave = doc.content;
    const pendingDuringSave = structuredClone(doc.pendingDraft);
    remote.set(doc.externalId!, workspaceSnapshot(doc.externalId!, 'Human revision during save', 'Latest human edit must remain current.'));
    write.reject(new Error('Workspace file changed during save'));
    await work;

    expect(visibleDuringSave).toContain('Canonical current plan.');
    expect(pendingDuringSave?.content).toBe('AI proposal from the prior workspace version.');
    expect(doc.title).toBe('Human revision during save');
    expect(doc.content).toContain('Latest human edit must remain current.');
    expect(doc.pendingDraft).toMatchObject({ id: pendingDuringSave?.id, content: 'AI proposal from the prior workspace version.' });
    expect(doc.workspace?.status).toBe('conflict');
    expect(meeting.working).toBe(false);
  });

  it.each([true, undefined])('retains a review requirement through failed refreshes even if writes recover: requiresReview=%s', async requiresReview => {
    const { worker, meeting, doc, remote, agents, workspace } = setupWithWorkspace();
    const canonical = artifactContent(doc);
    const snapshot = structuredClone(meeting.documentSnapshots![doc.id]);
    worker.workspaceSync.stage(meeting, doc, { ...canonical, content: 'An older proposal awaiting review.' }, canonical);
    if (requiresReview === undefined) delete doc.pendingDraft!.requiresReview;
    doc.workspace!.status = 'conflict';
    doc.saveStatus = 'failed';
    const source = structuredClone(meeting.pendingDraftSources![doc.id]);
    let providerRecoveredBeforeWrite = false;
    workspace.get
      .mockRejectedValueOnce(new Error('The initial refresh could not reach the workspace'))
      .mockImplementationOnce(async () => {
        // This read failed, but a subsequent save would now be accepted by the
        // transport. A transient UI status must not authorize the queued draft.
        providerRecoveredBeforeWrite = true;
        throw new Error('The final refresh response was lost');
      });
    agents.analyze.mockResolvedValue(output({
      documents: [{ ...analysis().documents[0], content: 'A newly generated proposal that still requires review.' }],
    }));

    await worker.run(meeting.id);

    expect(providerRecoveredBeforeWrite).toBe(true);
    expect((agents.analyze.mock.calls[0][0].currentState as StoredMeeting).documents[0].workspace?.status).toBe('error');
    expect(workspace.save.mock.calls.filter(([input]) => input.id === doc.externalId)).toEqual([]);
    expect(artifactContent(doc)).toEqual(canonical);
    expect(meeting.documentSnapshots![doc.id]).toEqual(snapshot);
    expect(remote.get(doc.externalId!)).toEqual(snapshot);
    expect(meeting.pendingDraftSources![doc.id]).toEqual(source);
    expect(doc.pendingDraft).toMatchObject({ content: 'A newly generated proposal that still requires review.', requiresReview: true });
    expect(doc.workspace?.status).toBe('conflict');
  });

  it('refreshes ended meetings quietly and runs an explicit update as a closing pass without new research', async () => {
    const { worker, meeting, doc, remote, agents, exa, workspace } = setupWithWorkspace();
    meeting.phase = 'ended';
    const revision = meeting.revision;
    const schedule = vi.spyOn(worker, 'schedule').mockImplementation(() => undefined);
    remote.set(doc.externalId!, workspaceSnapshot(doc.externalId!, 'Post-meeting revision', 'Updated after the meeting ended.'));
    await worker.refreshWorkspace(meeting.id, { force: true });
    expect(meeting.phase).toBe('ended');
    expect(meeting.revision).toBe(revision);
    expect(doc.content).toContain('Updated after the meeting ended.');
    expect(schedule).not.toHaveBeenCalled();
    expect(agents.analyze).not.toHaveBeenCalled();
    expect(workspace.save).not.toHaveBeenCalled();

    agents.analyze.mockResolvedValue(output({ documents: [], researchQueries: ['Do not investigate during a closing pass'] }));
    const updated = worker.updateFromWorkspace(meeting.id);
    expect(updated.phase).toBe('closing');
    expect(schedule).toHaveBeenCalledWith(meeting.id, true);
    await worker.run(meeting.id);
    expect(agents.analyze).toHaveBeenCalledTimes(1);
    expect(agents.analyze.mock.calls[0][0].closing).toBe(true);
    expect(exa.search).not.toHaveBeenCalled();
    expect(meeting.phase).toBe('ended');
  });

  it('schedules active meetings only for changed feedback and does not schedule Keep workspace', async () => {
    const { worker, meeting, doc, remote } = setupWithWorkspace();
    const schedule = vi.spyOn(worker, 'schedule').mockImplementation(() => undefined);
    await worker.refreshWorkspace(meeting.id, { force: true });
    expect(schedule).not.toHaveBeenCalled();
    remote.set(doc.externalId!, workspaceSnapshot(doc.externalId!, doc.title, 'A meaningful edit.'));
    await worker.refreshWorkspace(meeting.id, { force: true });
    expect(schedule).toHaveBeenCalledTimes(1);
    await worker.addWorkspaceComment(meeting.id, doc.id, 'Please explain the assumptions.');
    expect(schedule).toHaveBeenCalledTimes(2);
    const draftId = worker.workspaceSync.stage(meeting, doc, { ...artifactContent(doc), content: 'An alternative draft.' }, artifactContent(doc));
    await worker.resolveWorkspaceDraft(meeting.id, doc.id, { action: 'keep-workspace', draftId, workspaceVersion: doc.workspace!.version! });
    expect(schedule).toHaveBeenCalledTimes(2);
    meeting.phase = 'ended';
    await worker.addWorkspaceComment(meeting.id, doc.id, 'A final annotation.');
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it.each(['active', 'ended'] as const)('schedules a reviewed draft application only for an active meeting: %s', async phase => {
    const { worker, meeting, doc } = setupWithWorkspace();
    meeting.phase = phase;
    const schedule = vi.spyOn(worker, 'schedule').mockImplementation(() => undefined);
    const draftId = worker.workspaceSync.stage(meeting, doc, { ...artifactContent(doc), content: 'Reviewed proposal.' }, artifactContent(doc));
    await worker.resolveWorkspaceDraft(meeting.id, doc.id, { action: 'apply-draft', draftId, workspaceVersion: doc.workspace!.version! });
    expect(doc.content).toContain('Reviewed proposal.');
    expect(doc.pendingDraft).toBeUndefined();
    if (phase === 'active') expect(schedule).toHaveBeenCalledWith(meeting.id);
    else expect(schedule).not.toHaveBeenCalled();
  });

  it.each(['normal analysis', 'no transcript', 'agent failure'])('remains closing until the final record write settles after %s', async scenario => {
    const { worker, meeting, agents, workspace } = setup();
    meeting.phase = 'closing';
    agents.analyze.mockResolvedValue(output({ documents: [] }));
    if (scenario === 'no transcript') meeting.transcript = [];
    if (scenario === 'agent failure') agents.analyze.mockRejectedValue(new Error('Final analysis failed'));
    const started = deferred<Parameters<AmbiguousProvider['save']>[0]>();
    const finalWrite = deferred<WorkspaceDocument>();
    workspace.save.mockImplementationOnce(async input => { started.resolve(input); return finalWrite.promise; });
    const work = worker.run(meeting.id);
    const input = await started.promise;
    const phaseDuringWrite = meeting.phase;
    const workingDuringWrite = meeting.working;
    finalWrite.resolve({ id: 'final-record', title: input.title, content: input.content });
    await work;

    expect(phaseDuringWrite).toBe('closing');
    expect(workingDuringWrite).toBe(true);
    expect(meeting.phase).toBe('ended');
    expect(meeting.recordSaveStatus).toBe('saved');
    expect(meeting.working).toBe(false);
  });
});

describe("meeting worker", () => {
  it("runs bounded, deduplicated research and feeds actual sources into the same session before publishing", async () => {
    const { worker, meeting, agents, exa, workspace } = setup();
    const source = {
      title: "Community reference",
      url: "https://example.org/community",
      text: "Retrieved evidence.",
    };
    agents.analyze
      .mockReset()
      .mockResolvedValueOnce(
        output({
          researchQueries: [
            "venue options",
            "venue options",
            "pilot examples",
            "third query",
          ],
        }),
      )
      .mockResolvedValueOnce(
        output({
          documents: [
            {
              ...analysis().documents[0],
              content: `# Evidence\n\nA useful finding. [Source](${source.url})`,
            },
          ],
        }),
      );
    exa.search.mockResolvedValue([source]);
    await worker.run(meeting.id);
    expect(exa.search.mock.calls.map(([query]) => query)).toEqual([
      "venue options",
      "pilot examples",
    ]);
    expect(agents.analyze).toHaveBeenCalledTimes(2);
    expect(agents.analyze.mock.calls[1][0]).toMatchObject({
      sessionId: "sess_worker",
      currentState: {
        researchResults: [
          { query: "venue options", sources: [source] },
          { query: "pilot examples", sources: [source] },
        ],
      },
    });
    expect(meeting.sources).toEqual([source]);
    expect(meeting.documents[0]).toMatchObject({
      saveStatus: "saved",
      externalId: "external_1",
    });
    expect(workspace.save.mock.calls[0][0].content).toContain(source.url);
    expect(meeting.recordSaveStatus).toBe("saved");
    expect(meeting.processedRevision).toBe(meeting.revision);
  });

  it("incorporates direction that arrives during analysis without ending on obsolete decisions", async () => {
    const { worker, meeting, store, agents } = setup();
    append(store, meeting, "We agree to run two weeks.");
    const first = deferred<Awaited<ReturnType<AgentsProvider["analyze"]>>>();
    const analyzeStarted = deferred<void>();
    agents.analyze
      .mockReset()
      .mockImplementationOnce(async () => { analyzeStarted.resolve(); return first.promise; })
      .mockResolvedValueOnce(
        output({
          decisions: [
            {
              text: "Run one week.",
              evidence: "We agree to run one week instead.",
            },
          ],
          documents: [
            {
              ...analysis().documents[0],
              content: "# Pilot plan\n\nRun for one week.",
            },
          ],
        }),
      );
    const work = worker.run(meeting.id);
    await analyzeStarted.promise;
    append(store, meeting, "We agree to run one week instead.");
    first.resolve(
      output({
        decisions: [
          { text: "Run two weeks.", evidence: "We agree to run two weeks." },
        ],
        documents: [
          {
            ...analysis().documents[0],
            content: "# Pilot plan\n\nRun for two weeks.",
          },
        ],
      }),
    );
    await work;
    expect(agents.analyze).toHaveBeenCalledTimes(2);
    expect(agents.analyze.mock.calls[1][0].transcript).toContain(
      "one week instead",
    );
    expect(meeting.decisions.map((item) => item.text)).toEqual([
      "Run one week.",
    ]);
    expect(meeting.documents).toHaveLength(1);
    expect(meeting.documents[0].content).toContain("one week");
    expect(meeting.processedRevision).toBe(meeting.revision);
    expect(meeting.working).toBe(false);
  });

  it("discards an obsolete analysis when close arrives and starts no new investigations", async () => {
    const { worker, meeting, store, agents, exa, workspace } = setup();
    const first = deferred<Awaited<ReturnType<AgentsProvider["analyze"]>>>();
    const analyzeStarted = deferred<void>();
    agents.analyze
      .mockReset()
      .mockImplementationOnce(async () => { analyzeStarted.resolve(); return first.promise; })
      .mockResolvedValueOnce(
        output({
          summary: "Final handover with the venue still unresolved.",
          pending: [{ text: "Select a venue." }],
          researchQueries: [
            "A model-suggested query that must not run while closing",
          ],
          documents: [
            {
              ...analysis().documents[0],
              content: "# Final plan\n\nVenue selection remains incomplete.",
            },
          ],
        }),
      );
    const work = worker.run(meeting.id);
    await analyzeStarted.promise;
    meeting.phase = "closing";
    meeting.revision++;
    store.save(meeting);
    first.resolve(
      output({
        researchQueries: ["Old research query"],
        documents: [{ ...analysis().documents[0], content: "Obsolete draft" }],
      }),
    );
    await work;
    expect(agents.analyze.mock.calls[1][0].closing).toBe(true);
    expect(exa.search).not.toHaveBeenCalled();
    expect(
      workspace.save.mock.calls.some(
        ([value]) => value.content === "Obsolete draft",
      ),
    ).toBe(false);
    expect(meeting.phase).toBe("ended");
    expect(meeting.documents[0].status).toBe("incomplete");
    expect(workspace.save.mock.calls.at(-1)?.[0].content).toContain(
      "incomplete",
    );
    expect(meeting.pending[0].text).toBe("Select a venue.");
  });

  it("makes a labeled draft inspectable during ongoing discussion without publishing stale decisions", async () => {
    const { worker, meeting, store, agents } = setup();
    append(store, meeting, "We agree to run two weeks.");
    const first = deferred<Awaited<ReturnType<AgentsProvider["analyze"]>>>();
    const analyzeStarted = deferred<void>();
    const latest = deferred<Awaited<ReturnType<AgentsProvider["analyze"]>>>();
    const continuing = deferred<void>();
    agents.analyze
      .mockReset()
      .mockImplementationOnce(async () => { analyzeStarted.resolve(); return first.promise; })
      .mockImplementationOnce(async () => {
        continuing.resolve();
        return latest.promise;
      });
    const work = worker.run(meeting.id);
    await analyzeStarted.promise;
    append(
      store,
      meeting,
      "We now need to revisit the duration; do not treat two weeks as settled.",
    );
    first.resolve(
      output({
        decisions: [
          { text: "Run two weeks.", evidence: "We agree to run two weeks." },
        ],
      }),
    );
    await continuing.promise;
    expect(meeting.documents[0].saveStatus).toBe("saved");
    expect(meeting.documents[0].content).toMatch(
      /earlier conversation snapshot/i,
    );
    expect(meeting.decisions).toEqual([]);
    expect(meeting.working).toBe(true);
    latest.resolve(
      output({ pending: [{ text: "Resolve the revised duration." }] }),
    );
    await work;
    expect(meeting.documents[0].content).not.toMatch(
      /earlier conversation snapshot/i,
    );
    expect(meeting.pending[0].text).toBe("Resolve the revised duration.");
  });

  it("serializes writes and revises the same external document when direction arrives during a save", async () => {
    const { worker, meeting, store, agents, workspace } = setup();
    const saving = deferred<{ id: string; title: string; content: string }>();
    const started = deferred<void>();
    workspace.save.mockImplementationOnce(async (value) => {
      value.onCreated?.("existing_document");
      started.resolve();
      return saving.promise;
    });
    agents.analyze
      .mockReset()
      .mockResolvedValueOnce(output())
      .mockResolvedValueOnce(
        output({
          documents: [
            {
              ...analysis().documents[0],
              content: "# Revised plan\n\nMaximum budget: $200.",
            },
          ],
        }),
      );
    const work = worker.run(meeting.id);
    await started.promise;
    append(store, meeting, "We agree the budget cannot exceed $200.");
    saving.resolve({
      id: "existing_document",
      title: "Pilot plan",
      content: analysis().documents[0].content,
    });
    await work;
    expect(meeting.documents).toHaveLength(1);
    expect(meeting.documents[0]).toMatchObject({
      externalId: "existing_document",
      version: 2,
      saveStatus: "saved",
    });
    const updates = workspace.save.mock.calls.filter(
      ([value]) => value.id === "existing_document",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][0].lastContent).toBe(analysis().documents[0].content);
    expect(meeting.documents[0].content).toContain("$200");
  });

  it("preserves saved findings and drafts when research fails, and reports the failure to the model and record", async () => {
    const { worker, meeting, store, agents, exa, workspace } = setup();
    const source = {
      title: "Previous source",
      url: "https://example.org/previous",
      text: "Existing verified finding.",
    };
    meeting.sources = [source];
    await worker.run(meeting.id);
    const savedId = meeting.documents[0].externalId;
    append(
      store,
      meeting,
      "Please investigate venue availability, while preserving our current plan.",
    );
    agents.analyze
      .mockReset()
      .mockResolvedValueOnce(
        output({ researchQueries: ["venue availability"] }),
      )
      .mockResolvedValueOnce(output());
    exa.search.mockRejectedValue(new Error("Exa is temporarily unavailable."));
    await worker.run(meeting.id);
    expect(agents.analyze.mock.calls[1][0].currentState).toMatchObject({
      researchErrors: ["Exa is temporarily unavailable."],
    });
    expect(meeting.sources).toEqual([source]);
    expect(meeting.documents[0]).toMatchObject({
      externalId: savedId,
      saveStatus: "saved",
    });
    expect(meeting.error).toContain("Exa is temporarily unavailable");
    expect(workspace.save.mock.calls.at(-1)?.[0].content).toContain(
      "Incomplete work: Exa is temporarily unavailable.",
    );
  });

  it("keeps successful documents available when another workspace save fails and publishes a truthful record", async () => {
    const { worker, meeting, agents, workspace } = setup();
    agents.analyze.mockResolvedValue(
      output({
        documents: [
          analysis().documents[0],
          {
            key: "comparison",
            title: "Venue comparison",
            kind: "comparison",
            status: "draft",
            content: "# Venue comparison\n\nAn unfinished comparison.",
          },
        ],
      }),
    );
    const save = workspace.save.getMockImplementation()!;
    workspace.save.mockImplementation(async (value) => {
      if (value.title === "Venue comparison")
        throw new Error("Workspace write failed.");
      return save(value);
    });
    await worker.run(meeting.id);
    expect(meeting.documents[0].saveStatus).toBe("saved");
    expect(meeting.documents[1]).toMatchObject({
      saveStatus: "failed",
      error: "Workspace write failed.",
    });
    expect(meeting.documents[1].url).toBeUndefined();
    const record = workspace.save.mock.calls.at(-1)?.[0].content;
    expect(record).toContain("workspace save failed; local copy only");
    expect(record).toContain(meeting.documents[0].url);
    expect(
      meeting.activity.some(
        (item) =>
          item.kind === "document" && item.detail === "Venue comparison",
      ),
    ).toBe(false);
  });

  it("does not publish malformed model output and reuses its session on retry", async () => {
    const { worker, meeting, agents, workspace } = setup();
    agents.analyze
      .mockReset()
      .mockResolvedValueOnce({
        sessionId: "sess_invalid",
        text: "This is not JSON.",
      })
      .mockResolvedValueOnce(output());
    await worker.run(meeting.id);
    expect(workspace.save).not.toHaveBeenCalled();
    expect(meeting.error).toBeTruthy();
    expect(meeting.agentSessionId).toBe("sess_invalid");
    expect(meeting.working).toBe(false);
    await worker.run(meeting.id);
    expect(agents.analyze.mock.calls[1][0].sessionId).toBe("sess_invalid");
    expect(meeting.documents[0].saveStatus).toBe("saved");
  });

  it("keeps unsupported decisions pending and does not invent a speaker identity or commitment", async () => {
    const { worker, meeting, store, agents } = setup();
    append(store, meeting, "I will find a venue.");
    append(store, meeting, "Alex agreed to buy all supplies.", "assistant");
    agents.analyze.mockResolvedValue(
      output({
        decisions: [
          {
            text: "Buy all supplies.",
            evidence: "Alex agreed to buy all supplies.",
          },
        ],
        followUps: [
          {
            text: "Find a venue.",
            status: "agreed",
            owner: "Alex",
            evidence: "I will find a venue.",
          },
          {
            text: "Buy supplies.",
            status: "agreed",
            owner: "Alex",
            evidence: "Alex agreed to buy all supplies.",
          },
        ],
        ambiguities: [
          {
            text: "The speaker who volunteered to find a venue is unidentified.",
          },
        ],
      }),
    );
    await worker.run(meeting.id);
    expect(meeting.decisions).toEqual([]);
    expect(meeting.pending[0].text).toContain("Needs confirmation");
    expect(meeting.followUps[0]).toMatchObject({
      status: "agreed",
      owner: null,
    });
    expect(meeting.followUps[1]).toMatchObject({
      status: "proposed",
      owner: null,
    });
    expect(meeting.ambiguities).toHaveLength(1);
  });

  it("deduplicates concurrent work and repeated voice delegation IDs", async () => {
    const { worker, meeting, agents } = setup();
    const first = deferred<Awaited<ReturnType<AgentsProvider["analyze"]>>>();
    const analyzeStarted = deferred<void>();
    agents.analyze.mockImplementation(async () => { analyzeStarted.resolve(); return first.promise; });
    const firstDelegation = worker.delegate(meeting.id, "delegation_1");
    const duplicate = worker.delegate(meeting.id, "delegation_1");
    await analyzeStarted.promise;
    expect(agents.analyze).toHaveBeenCalledTimes(1);
    first.resolve(output());
    const [result, repeated] = await Promise.all([firstDelegation, duplicate]);
    expect(repeated).toEqual(result);
    expect(result.text).toContain("Verified saved in Ambiguous AI");
    expect(await worker.delegate(meeting.id, "delegation_1")).toEqual(result);
    expect(agents.analyze).toHaveBeenCalledTimes(1);
  });

  it("closes even after an agent failure, preserving prior work and marking unfinished drafts", async () => {
    const { worker, meeting, store, agents, workspace } = setup();
    await worker.run(meeting.id);
    meeting.phase = "closing";
    meeting.revision++;
    store.save(meeting);
    agents.analyze.mockRejectedValue(
      Object.assign(new Error("The final agent turn failed."), {
        sessionId: "sess_recoverable",
      }),
    );
    await worker.run(meeting.id);
    expect(meeting.phase).toBe("ended");
    expect(meeting.agentSessionId).toBe("sess_recoverable");
    expect(meeting.documents[0]).toMatchObject({
      status: "incomplete",
      saveStatus: "saved",
    });
    expect(meeting.recordSaveStatus).toBe("saved");
    expect(workspace.save.mock.calls.at(-1)?.[0].content).toContain(
      "The final agent turn failed.",
    );
    expect(meeting.working).toBe(false);
  });

  it("does not announce a saved handover when the record write fails", async () => {
    const { worker, meeting, store, workspace } = setup();
    meeting.phase = "closing";
    store.save(meeting);
    const save = workspace.save.getMockImplementation()!;
    workspace.save.mockImplementation(async (value) => {
      if (value.title.endsWith("meeting record"))
        throw new Error("The record could not be saved.");
      return save(value);
    });
    await worker.run(meeting.id);
    expect(meeting.phase).toBe("ended");
    expect(meeting.recordSaveStatus).toBe("failed");
    expect(meeting.recordUrl).toBeUndefined();
    expect(
      meeting.activity.some(
        (item) => item.title === "Handover saved in Ambiguous AI",
      ),
    ).toBe(false);
    expect(meeting.documents[0].saveStatus).toBe("saved");
  });
});
