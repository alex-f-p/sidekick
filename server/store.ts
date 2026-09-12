import { EventEmitter } from "node:events";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { ArtifactContent, Meeting } from "../shared/types";
import type { WorkspaceDocument } from "./providers/ambiguous";

export type StoredMeeting = Meeting & {
  agentSessionId?: string;
  agentInstructionsVersion?: number;
  previousAgentSessionIds?: string[];
  recordExternalId?: string;
  recordLastContent?: string;
  documentLastContents?: Record<string, string>;
  documentHumanEdited?: Record<string, boolean>;
  documentSnapshots?: Record<string, WorkspaceDocument>;
  pendingDraftSources?: Record<string, ArtifactContent>;
  delegationResults?: Record<
    string,
    { text: string; revision: number; speak?: boolean }
  >;
  receivedEventIds?: string[];
};
export class MeetingStore {
  private meetings = new Map<string, StoredMeeting>();
  readonly events = new EventEmitter();
  constructor(
    private directory = resolve(process.env.SIDEKICK_DATA_DIR || ".sidekick"),
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.events.setMaxListeners(100);
    for (const name of readdirSync(directory).filter((name) =>
      /^[\w-]+\.json$/.test(name),
    )) {
      try {
        const meeting = JSON.parse(
          readFileSync(resolve(directory, name), "utf8"),
        ) as StoredMeeting;
        if (!meeting.id || !Array.isArray(meeting.transcript)) continue;
        if (meeting.working || meeting.phase === "closing") {
          meeting.working = false;
          meeting.error =
            "The server restarted during work. Retry to finish and publish the latest state.";
        }
        this.meetings.set(meeting.id, meeting);
      } catch {
        console.warn(
          "A meeting file could not be read. The original file was preserved.",
        );
      }
    }
  }
  all() {
    return [...this.meetings.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(publicMeeting);
  }
  get(id: string) {
    const meeting = this.meetings.get(id);
    if (!meeting)
      throw Object.assign(new Error("Meeting not found."), { status: 404 });
    return meeting;
  }
  save(meeting: StoredMeeting) {
    meeting.stateVersion = (meeting.stateVersion ?? 0) + 1;
    const path = resolve(this.directory, `${meeting.id}.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify(meeting), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    this.meetings.set(meeting.id, meeting);
    this.events.emit(meeting.id, publicMeeting(meeting));
  }
}
export function publicMeeting(meeting: StoredMeeting): Meeting {
  const {
    agentSessionId,
    agentInstructionsVersion,
    previousAgentSessionIds,
    recordExternalId,
    recordLastContent,
    documentLastContents,
    documentSnapshots,
    documentHumanEdited,
    pendingDraftSources,
    delegationResults,
    receivedEventIds,
    ...value
  } = meeting;
  return value;
}
