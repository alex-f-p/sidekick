export type MeetingMode = 'live' | 'demo';
export type MeetingPhase = 'active' | 'closing' | 'ended';
export type RecordItem = {
  id: string;
  text: string;
  evidence?: string;
  owner?: string | null;
  status?: 'proposed' | 'agreed';
};
export type Transcript = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  audio?: boolean;
};
export type Source = { title: string; url: string; text: string };
export type DocumentFormat = 'document' | 'presentation' | 'spreadsheet';
export type PresentationContent = {
  slides: { title: string; bullets: string[]; notes?: string }[];
};
export type SpreadsheetCell = string | number | boolean | null;
export type SpreadsheetContent = {
  // Imported workbooks retain the native row numbers, including visible header rows.
  nativeCoordinates?: boolean;
  sheets: {
    name: string;
    columns: {
      key: string;
      label: string;
      type: 'text' | 'number' | 'currency' | 'date' | 'boolean' | 'formula';
    }[];
    rows: Record<string, SpreadsheetCell>[];
  }[];
};
export type ArtifactContent = {
  title: string;
  kind: 'research' | 'comparison' | 'proposal' | 'plan' | 'notes';
  content: string;
  // Older stored meetings omit format and continue to behave as ordinary documents.
  format?: DocumentFormat;
  presentation?: PresentationContent;
  spreadsheet?: SpreadsheetContent;
  status: 'draft' | 'complete' | 'incomplete';
};
export type WorkspaceComment = {
  id: string;
  content: string;
  authorName?: string;
  authorId?: string;
  createdAt: string;
  updatedAt?: string;
  resolved: boolean;
  parentId?: string;
};
export type WorkspaceSyncState = {
  status: 'unchecked' | 'checking' | 'current' | 'conflict' | 'error' | 'deleted';
  lastCheckedAt?: string;
  updatedAt?: string;
  version?: string;
  previewLimited?: boolean;
  notice?: string;
  comments?: WorkspaceComment[];
  commentsError?: string;
};
export type PendingArtifactDraft = ArtifactContent & {
  id: string;
  createdAt: string;
  reason?: string;
  requiresReview?: boolean;
};
export type WorkDocument = ArtifactContent & {
  id: string;
  key: string;
  saveStatus: 'local' | 'saving' | 'saved' | 'failed';
  url?: string;
  externalId?: string;
  version: number;
  updatedAt: string;
  error?: string;
  workspace?: WorkspaceSyncState;
  pendingDraft?: PendingArtifactDraft;
};
export type Activity = {
  id: string;
  at: string;
  kind:
    | 'listening'
    | 'thinking'
    | 'research'
    | 'document'
    | 'decision'
    | 'error'
    | 'system';
  title: string;
  detail?: string;
};
export type Meeting = {
  id: string;
  title: string;
  mode: MeetingMode;
  phase: MeetingPhase;
  startedAt: string;
  endedAt?: string;
  revision: number;
  processedRevision: number;
  stateVersion?: number;
  workspaceRevision?: number;
  working: boolean;
  summary: string;
  transcript: Transcript[];
  documents: WorkDocument[];
  decisions: RecordItem[];
  pending: RecordItem[];
  ambiguities: RecordItem[];
  followUps: RecordItem[];
  activity: Activity[];
  sources: Source[];
  recordUrl?: string;
  recordSaveStatus: 'local' | 'saving' | 'saved' | 'failed';
  recordDocument?: WorkDocument;
  workspaceCheckedAt?: string;
  workspaceError?: string;
  error?: string;
  spokenResponse?: string;
  demoStep: number;
};
export type IntegrationStatus = {
  id: string;
  name: string;
  configured: boolean;
  description: string;
};
export type AppConfig = {
  integrations: IntegrationStatus[];
  liveReady: boolean;
  workspaceUrl: string;
};
