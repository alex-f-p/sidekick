import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleHelp,
  ExternalLink,
  FileText,
  FolderOpen,
  Headphones,
  LayoutGrid,
  LoaderCircle,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  X,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Activity,
  AppConfig,
  DocumentFormat,
  Meeting,
  RecordItem,
  WorkDocument,
} from '../shared/types';
import { api } from './lib/api';
import { useMeetingVoice } from './hooks/useMeetingVoice';
import { useWorkspaceSync } from './hooks/useWorkspaceSync';
import { ArtifactIcon, artifactFormat, artifactFormats, artifactLabel, artifactSearchText, artifactSize } from './components/ArtifactPreview';
import { WorkspaceFile, WorkspaceStatus, WorkspaceToolbar } from './components/WorkspaceFile';
import { LandingPage } from './components/LandingPage';

type View = 'home' | 'meeting' | 'documents';
type Surface = 'landing' | 'workspace';
type Tab = 'workspace' | 'record' | 'transcript';
type RecordTab = 'decisions' | 'pending' | 'ambiguities' | 'followUps';
const recordTabs: { id: RecordTab; label: string; empty: string }[] = [
  {
    id: 'decisions',
    label: 'Decisions',
    empty:
      'Agreed decisions appear here. Suggestions stay separate until your team confirms them.',
  },
  {
    id: 'pending',
    label: 'Open questions',
    empty: 'No open questions recorded yet. Unanswered questions and pending choices appear here.',
  },
  {
    id: 'ambiguities',
    label: 'Uncertainties',
    empty:
      'No uncertainties recorded yet. Conflicting views and unclear points appear here for your team to resolve.',
  },
  {
    id: 'followUps',
    label: 'Follow-ups',
    empty:
      'Next steps appear here. Sidekick names an owner only when someone agrees to take the task.',
  },
];
const demoSteps = [
  'Compare two event formats',
  'Add a budget limit',
  'Choose the pilot format',
  'Review the meeting record',
];

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Waveform({
  animated = false,
  large = false,
}: {
  animated?: boolean;
  large?: boolean;
}) {
  return (
    <div
      className={`waveform ${animated ? 'animated' : ''} ${large ? 'large' : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length: large ? 37 : 21 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${[8, 16, 12, 26, 19, 35, 23, 15, 30, 44, 25, 37, 18, 28, 12, 33, 22, 40, 18][i % 19]}px`,
            animationDelay: `${i * -0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

function readableDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function elapsed(start: string, end?: string) {
  const seconds = Math.max(
    0,
    Math.floor(
      ((end ? new Date(end).getTime() : Date.now()) -
        new Date(start).getTime()) /
        1000,
    ),
  );
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function SessionTimer({ meeting }: { meeting: Meeting }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (meeting.endedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [meeting.endedAt]);
  return (
    <span className="session-timer">
      {elapsed(meeting.startedAt, meeting.endedAt)}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function DocumentCard({
  document,
  onOpen,
}: {
  document: WorkDocument;
  onOpen: () => void;
}) {
  const excerpt = document.content
    .replace(/^#{1,6}\s.+$/gm, '')
    .replace(/[\*#\[\]`]/g, '')
    .trim()
    .slice(0, 136);
  const workspaceUrl = safeUrl(document.url ?? '');
  return (
    <article
      className={`document-card document-${document.kind}`}
    >
      <div className="document-card-top">
        <span className="document-icon">
          <ArtifactIcon document={document} />
        </span>
        <span
          className={`status-pill ${document.status === 'complete' ? 'success' : document.status === 'incomplete' ? 'warning' : ''}`}
        >
          {document.status === 'complete'
            ? 'Ready'
            : document.status === 'incomplete'
              ? 'Incomplete'
              : 'Draft'}
        </span>
      </div>
      <span className="document-kind">{artifactLabel(document)} <span aria-hidden="true">·</span> {document.kind}{artifactSize(document) && <> <span aria-hidden="true">·</span> {artifactSize(document)}</>}</span>
      <h3>
        <button className="document-card-open" onClick={onOpen}>
          {document.title}
        </button>
      </h3>
      <p>
        {excerpt || 'No summary available yet.'}
        {excerpt.length >= 136 ? '…' : ''}
      </p>
      <div className="document-card-footer">
        <span>
          {document.saveStatus === 'saved' ? (
            <>
              <CheckCheck size={13} /> Saved to workspace
            </>
          ) : document.saveStatus === 'saving' ? (
            <>
              <LoaderCircle size={13} className="spin" /> Saving
            </>
          ) : document.saveStatus === 'failed' ? (
            <>
              <AlertCircle size={13} /> Save failed
            </>
          ) : (
            <>
              <FolderOpen size={13} /> Local draft
            </>
          )}
        </span>
        <span>
          v{document.version} <ArrowUpRight size={14} />
        </span>
      </div>
      {(document.externalId || document.url) && <WorkspaceStatus workspace={document.workspace} compact />}
      {workspaceUrl && (
        <a
          className="document-workspace-link"
          href={workspaceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open in Ambiguous: ${document.title}`}
        >
          Open in Ambiguous <ArrowUpRight size={14} />
        </a>
      )}
    </article>
  );
}

function RecordList({
  items,
  empty,
  type,
}: {
  items: RecordItem[];
  empty: string;
  type: RecordTab;
}) {
  return items.length ? (
    <div className="record-list">
      {items.map((item) => (
        <div className="record-item" key={item.id}>
          <span className={`record-item-icon ${type}`}>
            {type === 'decisions' ? (
              <Check size={16} />
            ) : type === 'followUps' ? (
              <ArrowRight size={16} />
            ) : (
              <CircleHelp size={16} />
            )}
          </span>
          <div>
            <p>{item.text}</p>
            {item.evidence && <blockquote>{item.evidence}</blockquote>}
            {(item.owner || item.status) && (
              <div className="record-item-meta">
                {item.status && (
                  <span>
                    {item.status === 'agreed' ? 'Agreed' : 'Proposed'}
                  </span>
                )}
                {item.owner && <span>Owner: {item.owner}</span>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="record-empty">
      <Circle size={22} strokeWidth={1.25} />
      <p>{empty}</p>
    </div>
  );
}

function ActivityIcon({ kind }: { kind: Activity['kind'] }) {
  const Icon =
    kind === 'research'
      ? Search
      : kind === 'document'
        ? FileText
        : kind === 'decision'
          ? Check
          : kind === 'error'
            ? AlertCircle
            : kind === 'listening'
              ? AudioLines
              : kind === 'thinking'
                ? Sparkles
                : Circle;
  return <Icon size={14} />;
}

function ActivityPanel({ meeting }: { meeting: Meeting }) {
  return (
    <aside className="activity-panel">
      <div className="activity-heading">
        <h2>Sidekick’s activity</h2>
        <span className={`presence-dot ${meeting.working ? 'working' : ''}`} />
      </div>
      <div className={`sidekick-status ${meeting.working ? 'is-working' : ''}`}>
        <div className="sidekick-avatar">
          <BrandMark small />
        </div>
        <div>
          <strong>
            {meeting.working
              ? 'Reviewing the discussion'
              : meeting.phase === 'ended'
                ? 'Meeting ended'
                : 'Ready for your next question'}
          </strong>
          <p>
            {meeting.working
              ? 'Check the activity below for progress.'
              : meeting.phase === 'ended'
                ? 'Review your files and meeting record.'
                : 'Ask me to research a question or draft a file.'}
          </p>
        </div>
      </div>
      <div className="section-label activity-label">
        ACTIVITY <span>{meeting.activity.length}</span>
      </div>
      <ol className="activity-feed">
        {meeting.activity.slice(0, 25).map((event) => (
          <li key={event.id} className={`activity-${event.kind}`}>
            <span className="activity-icon">
              <ActivityIcon kind={event.kind} />
            </span>
            <div>
              <h3>{event.title}</h3>
              {event.detail && <p>{event.detail}</p>}
              <time>
                {new Date(event.at).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          </li>
        ))}
      </ol>
      {meeting.activity.length === 0 && (
        <p className="muted activity-empty">
          Research, file updates, and saved decisions will appear here.
        </p>
      )}
      <div className="quiet-note">
        <span className="quiet-note-icon">
          <Headphones size={16} />
        </span>
        <p>
          You lead the discussion.
          <br />Sidekick helps with research and drafts.
        </p>
      </div>
    </aside>
  );
}

export default function App() {
  const [surface, setSurface] = useState<Surface>(() =>
    window.location.pathname.startsWith('/workspace') ? 'workspace' : 'landing',
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('home');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('workspace');
  const [recordTab, setRecordTab] = useState<RecordTab>('decisions');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [contribution, setContribution] = useState('');
  const [search, setSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState<'all' | DocumentFormat>('all');
  const [connectionLost, setConnectionLost] = useState(false);

  const upsert = useCallback((meeting: Meeting) => {
    setMeetings((previous) => {
      const index = previous.findIndex((item) => item.id === meeting.id);
      if (index === -1) return [meeting, ...previous];
      if (previous[index].revision > meeting.revision || (previous[index].stateVersion ?? 0) > (meeting.stateVersion ?? 0)) return previous;
      return previous.map((item) => (item.id === meeting.id ? meeting : item));
    });
  }, []);
  const showError = useCallback((message: string) => setError(message), []);
  const voice = useMeetingVoice(upsert, showError);
  const selected = meetings.find((meeting) => meeting.id === selectedId);
  const selectedFailure =
    selected?.error ||
    selected?.documents.find((document) => document.saveStatus === 'failed')
      ?.error ||
    (selected?.documents.some((document) => document.saveStatus === 'failed') ||
    selected?.recordSaveStatus === 'failed'
      ? 'A workspace save failed. Your local work is preserved.'
      : null);
  const allDocuments = useMemo(() => meetings.flatMap((meeting) =>
    meeting.documents.map((document) => ({ document, meeting, searchText: artifactSearchText(document) })),
  ), [meetings]);
  const filteredDocuments = allDocuments.filter(({ document, searchText }) =>
    (formatFilter === 'all' || artifactFormat(document) === formatFilter) && searchText.includes(search.toLowerCase()),
  );
  const opened = allDocuments.find(
    ({ document }) => document.id === documentId,
  );
  const workspaceMeeting = opened?.meeting ?? (view === 'meeting' ? selected : undefined);
  const workspaceTargetId = opened?.document.id ?? (view === 'meeting' && tab === 'record' ? 'record' : undefined);
  const workspaceTarget = opened?.document ?? (workspaceTargetId === 'record' ? workspaceMeeting?.recordDocument : undefined);
  const workspaceEnabled = surface === 'workspace' && workspaceMeeting?.mode === 'live' && Boolean(
    workspaceTargetId
      ? workspaceTarget?.externalId || workspaceTarget?.url || (workspaceTargetId === 'record' && workspaceMeeting?.recordUrl)
      : workspaceMeeting?.recordUrl || workspaceMeeting?.documents.some(document => document.externalId || document.url),
  );
  const workspaceSync = useWorkspaceSync({
    meetingId: workspaceMeeting?.id,
    documentId: workspaceTargetId,
    enabled: workspaceEnabled,
    poll: workspaceEnabled && (Boolean(workspaceTargetId) || workspaceMeeting?.phase === 'active'),
    onMeeting: upsert,
  });
  const voiceActive =
    voice.meetingId === selectedId &&
    (voice.state === 'listening' || voice.state === 'muted');
  const voiceConnecting =
    voice.meetingId === selectedId && voice.state === 'connecting';

  const load = useCallback(async () => {
    setLoading(true);
    const [configuration, sessions] = await Promise.allSettled([
      api.config(),
      api.meetings(),
    ]);
    if (configuration.status === 'fulfilled') setConfig(configuration.value);
    else
      showError(
        configuration.reason instanceof Error
          ? configuration.reason.message
          : 'Could not load integration status.',
      );
    if (sessions.status === 'fulfilled') setMeetings(sessions.value);
    else
      showError(
        sessions.reason instanceof Error
          ? sessions.reason.message
          : 'Could not load your meetings.',
      );
    setLoading(false);
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const syncSurface = () => {
      setSurface(window.location.pathname.startsWith('/workspace') ? 'workspace' : 'landing');
      setSidebar(false);
      setSettings(false);
      setDocumentId(null);
    };
    window.addEventListener('popstate', syncSurface);
    return () => window.removeEventListener('popstate', syncSurface);
  }, []);
  useEffect(() => {
    document.title = surface === 'landing'
      ? 'Sidekick — Research and drafts while your team meets'
      : `${view === 'home' ? 'Overview' : view === 'documents' ? 'All files' : selected?.title ?? 'Meeting'} · Sidekick`;
  }, [surface, view, selected?.title]);
  useEffect(() => {
    if (surface !== 'landing' || !voice.meetingId) return;
    // The landing page has no microphone controls. Stop audio and flush speech
    // when leaving the workspace, including navigation with browser Back.
    void voice.disconnect().catch((cause) => {
      showError(cause instanceof Error ? cause.message : 'Some spoken messages could not be saved.');
      window.history.replaceState(null, '', '/workspace');
      setSurface('workspace');
    });
  }, [surface, voice.meetingId, voice.disconnect, showError]);
  useEffect(() => {
    if (!selectedId) return;
    setConnectionLost(false);
    const events = new EventSource(`/api/meetings/${selectedId}/events`);
    events.addEventListener('meeting', (event) => {
      try {
        upsert(JSON.parse((event as MessageEvent).data) as Meeting);
        setConnectionLost(false);
      } catch {
        setConnectionLost(true);
      }
    });
    events.onopen = () => setConnectionLost(false);
    events.onerror = () => setConnectionLost(true);
    return () => events.close();
  }, [selectedId, upsert]);
  const openedMeetingId = opened?.meeting.id;
  useEffect(() => {
    if (!openedMeetingId || openedMeetingId === selectedId) return;
    const events = new EventSource(`/api/meetings/${openedMeetingId}/events`);
    events.addEventListener('meeting', event => {
      try { upsert(JSON.parse((event as MessageEvent).data) as Meeting); } catch { /* The next refresh recovers malformed events. */ }
    });
    return () => events.close();
  }, [openedMeetingId, selectedId, upsert]);

  async function run(name: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  function navigate(next: View) {
    setView(next);
    setSidebar(false);
  }

  function changeSurface(next: Surface) {
    const pathname = next === 'workspace' ? '/workspace' : '/';
    if (window.location.pathname !== pathname) window.history.pushState(null, '', pathname);
    setSurface(next);
    setSidebar(false);
    setSettings(false);
    setDocumentId(null);
    window.scrollTo(0, 0);
  }

  function enterWorkspace() {
    changeSurface('workspace');
    navigate('home');
  }

  function openMeeting(meeting: Meeting) {
    if (voice.meetingId && voice.meetingId !== meeting.id)
      void voice
        .disconnect()
        .catch((cause) =>
          showError(
            cause instanceof Error
              ? cause.message
              : 'Could not finish saving the audio.',
          ),
        );
    setSelectedId(meeting.id);
    setTab('workspace');
    setView('meeting');
    setSidebar(false);
    setContribution('');
    setError(null);
  }

  async function createMeeting(mode: 'live' | 'demo') {
    await run('create', async () => {
      await voice.disconnect();
      const meeting = await api.create(mode);
      upsert(meeting);
      openMeeting(meeting);
      if (mode === 'live' && config?.liveReady) void voice.connect(meeting.id);
    });
  }

  async function closeMeeting() {
    if (!selected) return;
    const id = selected.id;
    await run('close', async () => {
      if (voice.meetingId === id) await voice.disconnect();
      upsert(await api.close(id));
    });
  }

  async function sendContribution(event: FormEvent) {
    event.preventDefault();
    if (!selected || !contribution.trim()) return;
    const text = contribution.trim();
    const id = selected.id;
    await run('contribute', async () => {
      await voice.flush();
      upsert(await api.transcript(id, text, 'user', crypto.randomUUID()));
      if (voice.meetingId === id)
        voice.sendContext(
          `A participant added to the meeting in writing: ${text}`,
        );
      setContribution('');
    });
  }

  const integrationsConfigured =
    config?.integrations.filter((integration) => integration.configured)
      .length ?? 0;

  if (surface === 'landing') {
    return <LandingPage
      onEnterWorkspace={enterWorkspace}
      onExploreDemo={() => {
        enterWorkspace();
        void createMeeting('demo');
      }}
      busy={Boolean(busy)}
    />;
  }

  return (
    <div className={`app ${sidebar ? 'sidebar-open' : ''}`}>
      {sidebar && (
        <button
          className="sidebar-backdrop"
          onClick={() => setSidebar(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className="sidebar" id="workspace-navigation">
        <button
          className="brand"
          onClick={() => changeSurface('landing')}
          aria-label="Sidekick website"
        >
          <BrandMark />
          <span>
            sidekick<span className="brand-period">.</span>
          </span>
        </button>
        <button
          className="new-meeting"
          onClick={() => void createMeeting('live')}
          disabled={!!busy}
        >
          <Plus size={17} /> New meeting{' '}
          <span className="new-shortcut">
            <AudioLines size={13} />
          </span>
        </button>
        <div className="section-label nav-label">Workspace</div>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${view === 'home' ? 'active' : ''}`}
            aria-current={view === 'home' ? 'page' : undefined}
            onClick={() => navigate('home')}
          >
            <LayoutGrid size={17} />
            <span>Overview</span>
          </button>
          <button
            className={`nav-item ${view === 'documents' ? 'active' : ''}`}
            aria-current={view === 'documents' ? 'page' : undefined}
            onClick={() => navigate('documents')}
          >
            <FolderOpen size={18} />
            <span>All files</span>
            <span className="nav-count">{allDocuments.length}</span>
          </button>
        </nav>
        <div className="section-label sessions-label">
          Your meetings <span>{meetings.length}</span>
        </div>
        <nav className="meetings-nav" aria-label="Your meetings">
          {meetings.length ? (
            meetings.map((meeting) => (
              <button
                className={`meeting-nav-item ${view === 'meeting' && selectedId === meeting.id ? 'active' : ''}`}
                aria-current={view === 'meeting' && selectedId === meeting.id ? 'page' : undefined}
                title={meeting.title}
                key={meeting.id}
                onClick={() => openMeeting(meeting)}
              >
                <span
                  className={`meeting-nav-dot ${meeting.phase === 'active' ? 'active' : ''}`}
                />
                <span>{meeting.title}</span>
                {meeting.mode === 'demo' && (
                  <span className="demo-mini">DEMO</span>
                )}
              </button>
            ))
          ) : (
            <p className="sidebar-empty">
              Your meetings will
              <br />
              appear here.
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="integration-nav" onClick={() => setSettings(true)}>
            <span
              className={`integration-indicator ${integrationsConfigured === config?.integrations.length && integrationsConfigured > 0 ? 'ready' : ''}`}
            />
            <span>
              Integrations
              <span>
                {loading
                  ? 'Checking connections'
                  : `${integrationsConfigured} of ${config?.integrations.length ?? 3} configured`}
              </span>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebar(true)}
              aria-label="Open navigation"
              aria-controls="workspace-navigation"
              aria-expanded={sidebar}
            >
              <Menu size={20} />
            </button>
            <span className="workspace-name">Your workspace</span>
            <ChevronRight size={13} />
            <span>
              {view === 'home'
                ? 'Overview'
                : view === 'documents'
                  ? 'All files'
                  : 'Meeting room'}
            </span>
          </div>
          <div className="topbar-right">
            {voice.meetingId && !['closed', 'error'].includes(voice.state) && (
              <button
                className="ongoing-indicator"
                onClick={() => {
                  const current = meetings.find(
                    (m) => m.id === voice.meetingId,
                  );
                  if (current) openMeeting(current);
                }}
              >
                <span className="presence-dot" />
                {voice.state === 'muted'
                  ? 'Mic muted'
                  : voice.state === 'connecting'
                    ? 'Connecting'
                    : 'Meeting in progress'}
              </button>
            )}
            <span className="today-date">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="workspace-avatar" title="Local workspace">
              <BrandMark small />
            </span>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}

        {view === 'home' && (
          <main className="home-view">
            <div className="overview-heading">
              <div>
                <h1>Overview</h1>
                <p>Pick up where you left off, or start a new meeting.</p>
              </div>
              <div className="overview-actions">
                <button className="button secondary" onClick={() => void createMeeting('demo')} disabled={!!busy}>
                  <Play size={14} /> Explore a demo
                </button>
                <button className="button primary" onClick={() => void createMeeting('live')} disabled={!!busy}>
                  {busy === 'create' ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} New meeting
                </button>
              </div>
            </div>

            <section className="recent-section">
              <div className="section-heading">
                <div>
                  <h2>Meetings</h2>
                  <p>Reopen a meeting to review its files, decisions, and transcript.</p>
                </div>
                <span className="subtle-count">
                  {meetings.length}{' '}
                  {meetings.length === 1 ? 'meeting' : 'meetings'}
                </span>
              </div>
              {loading ? (
                <div className="list-loading">
                  <LoaderCircle size={19} className="spin" /> Opening your
                  workspace…
                </div>
              ) : meetings.length ? (
                <div className="recent-list">
                  {meetings.slice(0, 5).map((meeting) => (
                    <button
                      key={meeting.id}
                      className="recent-meeting"
                      onClick={() => openMeeting(meeting)}
                    >
                      <span className="recent-icon">
                        <AudioLines size={20} />
                      </span>
                      <span className="recent-title">
                        <strong>{meeting.title}</strong>
                        <span>
                          {readableDate(meeting.startedAt)} <i>·</i>{' '}
                          {meeting.documents.length}{' '}
                          {meeting.documents.length === 1 ? 'file' : 'files'}
                          {meeting.mode === 'demo' ? ' · Demo' : ''}
                        </span>
                      </span>
                      <span
                        className={`status-pill ${meeting.phase === 'active' ? 'success' : ''}`}
                      >
                        {meeting.phase === 'ended'
                          ? 'Finished'
                          : meeting.phase === 'closing'
                            ? 'Wrapping up'
                            : 'In progress'}
                      </span>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="first-meeting-card">
                  <span className="first-meeting-icon">
                    <AudioLines size={24} strokeWidth={1.5} />
                  </span>
                  <div>
                    <h3>No meetings yet</h3>
                    <p>
                      Start a meeting to collect your files, decisions, and transcript.
                    </p>
                  </div>
                  <button
                    className="circle-button"
                    onClick={() => void createMeeting('live')}
                    disabled={!!busy}
                    aria-label="Start your first meeting"
                  >
                    <ArrowUpRight size={21} />
                  </button>
                </div>
              )}
            </section>
            {allDocuments.length > 0 && (
              <section className="overview-files">
                <div className="section-heading">
                  <div>
                    <h2>Recent files</h2>
                    <p>Work from your latest conversations.</p>
                  </div>
                  <button className="inline-link" onClick={() => navigate('documents')}>
                    View all files <ArrowRight size={13} />
                  </button>
                </div>
                <div className="document-grid all-documents overview-file-grid">
                  {allDocuments.slice(0, 3).map(({ document }) => (
                    <DocumentCard key={document.id} document={document} onOpen={() => setDocumentId(document.id)} />
                  ))}
                </div>
              </section>
            )}
          </main>
        )}

        {view === 'documents' && (
          <main className="documents-view">
            <div className="page-eyebrow">Your meeting files</div>
            <div className="page-title-row">
              <div>
                <h1>All meeting files</h1>
                <p>Documents, presentations, and spreadsheets from your conversations.</p>
              </div>
              <label className="document-search">
                <Search size={17} />
                <input
                  placeholder="Search files…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search meeting files"
                />
              </label>
            </div>
            {allDocuments.length > 0 && (
              <div className="artifact-library-toolbar">
                <div className="artifact-filters" role="group" aria-label="Filter files by format">
                  <button className={formatFilter === 'all' ? 'active' : ''} aria-pressed={formatFilter === 'all'} onClick={() => setFormatFilter('all')}>All files <span>{allDocuments.length}</span></button>
                  {artifactFormats.map(format => (
                    <button key={format.id} className={formatFilter === format.id ? 'active' : ''} aria-pressed={formatFilter === format.id} onClick={() => setFormatFilter(format.id)}><format.icon size={14} />{format.plural}<span>{allDocuments.filter(({ document }) => artifactFormat(document) === format.id).length}</span></button>
                  ))}
                </div>
              </div>
            )}
            {loading ? (
              <div className="list-loading" role="status"><LoaderCircle size={18} className="spin" /> Loading your files…</div>
            ) : allDocuments.length ? (
              <div className="document-grid all-documents">
                {filteredDocuments
                  .map(({ document, meeting }) => (
                    <div key={document.id}>
                      <DocumentCard
                        document={document}
                        onOpen={() => setDocumentId(document.id)}
                      />
                      <button
                        className="document-meeting-link"
                        onClick={() => openMeeting(meeting)}
                      >
                        <AudioLines size={12} />
                        {meeting.title}
                        <ArrowUpRight size={12} />
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="empty-documents">
                <span className="empty-document-icon">
                  <FileText size={30} strokeWidth={1.25} />
                </span>
                <h2>No meeting files yet.</h2>
                <p>
                  Start a meeting and ask Sidekick to draft a brief,
                  <br />
                  presentation, or planning sheet. Your files will appear here.
                </p>
                <button
                  className="button primary"
                  onClick={() => void createMeeting('live')}
                  disabled={!!busy}
                >
                  <Plus size={17} /> Start a meeting
                </button>
              </div>
            )}
            {!loading && allDocuments.length > 0 && filteredDocuments.length === 0 && (
                <div className="record-empty">
                  <Search size={24} />
                  <p>{search ? `No files match “${search}”${formatFilter !== 'all' ? ' in this format' : ''}.` : 'No files in this format yet.'}</p>
                  <button className="inline-link" onClick={() => { setSearch(''); setFormatFilter('all'); }}>Show all files <ArrowRight size={13} /></button>
                </div>
              )}
          </main>
        )}

        {view === 'meeting' && selected && (
          <main className="meeting-view">
            <div className="meeting-title-row">
              <div>
                <div className="meeting-eyebrow">
                  <span
                    className={`presence-dot ${selected.phase === 'ended' ? 'ended' : ''}`}
                  />
                  {selected.mode === 'demo'
                    ? 'SIMULATED DEMO'
                    : selected.phase === 'ended'
                      ? 'MEETING COMPLETE'
                      : 'MEETING IN PROGRESS'}
                  <span className="eyebrow-divider">/</span>
                  {readableDate(selected.startedAt)}
                </div>
                <h1>{selected.title}</h1>
              </div>
              <a
                className="button secondary export-button"
                aria-label="Export meeting"
                href={`/api/meetings/${selected.id}/export`}
                download
              >
                <ArrowDownToLine size={16} />
                <span>Export meeting</span>
              </a>
            </div>
            {connectionLost && (
              <div className="notice-bar">
                <LoaderCircle size={14} className="spin" /> Reconnecting to meeting updates. Recent changes may take a moment to appear.
              </div>
            )}
            {selected.mode === 'demo' && (
              <div className="demo-banner">
                <span className="demo-tag">
                  <Play size={10} fill="currentColor" /> DEMO
                </span>
                <p>
                  Try a four-step example with sample research and drafts.
                  Files stay in this app; no microphone needed.
                </p>
                <span>{Math.min(selected.demoStep, 4)} / 4</span>
              </div>
            )}
            <div className="meeting-layout">
              <div className="meeting-workspace">
                <section
                  className={`session-console ${selected.phase === 'ended' ? 'session-ended' : ''}`}
                  aria-label="Meeting controls"
                >
                  <div className="console-leading">
                    <div className="console-brand">
                      <BrandMark small />
                    </div>
                    <div>
                      <h2>
                        {selected.phase === 'ended'
                          ? 'Meeting ended.'
                          : selected.phase === 'closing' || busy === 'close'
                            ? 'Preparing the meeting record…'
                            : selected.mode === 'demo'
                              ? 'Explore a sample meeting.'
                              : voiceConnecting
                                ? 'Connecting your microphone…'
                                : voiceActive
                                  ? voice.state === 'muted'
                                    ? 'Your microphone is muted.'
                                    : 'Your microphone is on.'
                                  : 'Ready to start.'}
                      </h2>
                      <p>
                        {selected.phase === 'ended'
                          ? 'Review your meeting record and files below.'
                          : selected.mode === 'demo'
                            ? 'Select each step to see the files and decisions update.'
                            : voiceActive
                              ? voice.state === 'muted'
                                ? 'Microphone muted. Work continues in the background.'
                                : 'Speak naturally. Say “Sidekick” when you need a hand.'
                              : 'Connect your microphone or add a thought below.'}
                      </p>
                    </div>
                  </div>
                  <div className="console-controls">
                    <Waveform
                      animated={voiceActive && voice.state !== 'muted'}
                    />
                    <SessionTimer meeting={selected} />
                    {selected.phase === 'active' &&
                      selected.mode === 'live' && (
                        <button
                          className={`console-icon-button ${voice.state === 'muted' ? 'is-muted' : ''}`}
                          onClick={() =>
                            voiceActive
                              ? voice.toggleMuted()
                              : void voice.connect(
                                  selected.id,
                                  selected.summary
                                    ? `Resuming this meeting. Current summary: ${selected.summary}. Explicit decisions: ${selected.decisions.map((item) => item.text).join('; ')}. Open questions: ${selected.pending.map((item) => item.text).join('; ')}.`
                                    : undefined,
                                )
                          }
                          disabled={
                            voiceConnecting || !config?.liveReady || !!busy
                          }
                          aria-label={
                            voiceActive
                              ? voice.state === 'muted'
                                ? 'Unmute microphone'
                                : 'Mute microphone'
                              : 'Connect microphone'
                          }
                          title={
                            !config?.liveReady
                              ? 'Configure OpenAI to enable voice'
                              : voiceActive
                                ? 'Toggle microphone'
                                : 'Connect microphone'
                          }
                        >
                          {voiceConnecting ? (
                            <LoaderCircle size={17} className="spin" />
                          ) : voiceActive && voice.state !== 'muted' ? (
                            <Mic size={17} />
                          ) : (
                            <MicOff size={17} />
                          )}
                        </button>
                      )}
                    {selected.phase === 'active' && (
                      <button
                        className="end-button"
                        onClick={() => void closeMeeting()}
                        disabled={!!busy}
                      >
                        <Square size={10} fill="currentColor" /> End meeting
                      </button>
                    )}
                    {selected.phase === 'ended' && (
                      <span className="console-done">
                        <Check size={17} />
                      </span>
                    )}
                  </div>
                </section>
                {voice.audioBlocked && voice.meetingId === selected.id && (
                  <button
                    className="audio-resume"
                    onClick={() => void voice.resumeAudio()}
                  >
                    <Headphones size={16} /> Enable Sidekick’s audio responses{' '}
                    <ArrowRight size={14} />
                  </button>
                )}
                {selected.mode === 'live' &&
                  !config?.liveReady &&
                  selected.phase === 'active' && (
                    <div className="voice-setup-note">
                      <MicOff size={14} />
                      <span>
                        Voice needs an OpenAI connection. You can contribute in
                        writing below.
                      </span>
                      <button onClick={() => setSettings(true)}>
                        View setup <ArrowUpRight size={12} />
                      </button>
                    </div>
                  )}
                {selected.mode === 'demo' && selected.phase === 'active' && (
                  <div className="demo-controller">
                    <div className="demo-progress">
                      {demoSteps.map((step, index) => (
                        <span
                          key={step}
                          className={
                            selected.demoStep > index
                              ? 'complete'
                              : selected.demoStep === index
                                ? 'current'
                                : ''
                          }
                          title={step}
                        >
                          {selected.demoStep > index ? (
                            <Check size={12} />
                          ) : (
                            index + 1
                          )}
                        </span>
                      ))}
                    </div>
                    <div>
                      <strong>
                        {selected.demoStep < 4
                          ? demoSteps[selected.demoStep]
                          : 'Review the files and meeting record'}
                      </strong>
                      <p>
                        {selected.demoStep === 0
                          ? 'Explore a neighborhood repair café and compare two formats.'
                          : selected.demoStep === 1
                            ? 'Two perspectives and a $2,000 limit. No agreement yet.'
                            : selected.demoStep === 2
                              ? 'Choose the pop-up pilot and watch the proposal take shape.'
                              : selected.demoStep === 3
                                ? 'Finish the demo and review open questions and unassigned next steps.'
                                : 'End the meeting to finish the meeting record.'}
                      </p>
                    </div>
                    <button
                      className="button secondary compact"
                      disabled={!!busy || selected.working}
                      onClick={() =>
                        selected.demoStep < 4
                          ? void run('demo', async () =>
                              upsert(await api.demoNext(selected.id)),
                            )
                          : void closeMeeting()
                      }
                    >
                      {busy === 'demo' || selected.working ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : selected.demoStep >= 4 ? (
                        <Check size={15} />
                      ) : (
                        <Play size={12} fill="currentColor" />
                      )}
                      {selected.demoStep >= 4
                        ? 'End meeting'
                        : selected.demoStep === 0
                          ? 'Begin demo'
                          : 'Next step'}
                    </button>
                  </div>
                )}
                <div
                  className="workspace-tabs"
                  role="tablist"
                  aria-label="Meeting views"
                  onKeyDown={handleTabKeys}
                >
                  {(
                    [
                      {
                        id: 'workspace',
                        label: 'Files',
                        icon: LayoutGrid,
                        count: selected.documents.length,
                      },
                      {
                        id: 'record',
                        label: 'Meeting record',
                        icon: BookOpen,
                        count:
                          selected.decisions.length +
                          selected.pending.length +
                          selected.ambiguities.length +
                          selected.followUps.length,
                      },
                      {
                        id: 'transcript',
                        label: 'Transcript',
                        icon: MessageSquare,
                        count: selected.transcript.length,
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      id={`tab-${item.id}`}
                      role="tab"
                      tabIndex={tab === item.id ? 0 : -1}
                      aria-selected={tab === item.id}
                      aria-controls={`panel-${item.id}`}
                      className={tab === item.id ? 'active' : ''}
                      onClick={() => setTab(item.id)}
                    >
                      <item.icon size={15} />
                      {item.label}
                      {item.count > 0 && <span>{item.count}</span>}
                    </button>
                  ))}
                </div>
                <section
                  id={`panel-${tab}`}
                  role="tabpanel"
                  aria-labelledby={`tab-${tab}`}
                  className="workspace-content"
                >
                  {tab === 'workspace' && (
                    <>
                      <div className="section-heading workspace-section-heading">
                        <div>
                          <h2>
                            Files from this meeting<span>.</span>
                          </h2>
                          <p>
                            {selected.documents.length
                              ? 'Open a file to review the latest draft and its save status.'
                              : 'Documents, presentations, and spreadsheets appear here as Sidekick creates them.'}
                          </p>
                        </div>
                        {selected.working && (
                          <span className="working-pill">
                            <LoaderCircle size={12} className="spin" /> Working
                          </span>
                        )}
                      </div>
                      <WorkspaceToolbar meeting={selected} refreshing={workspaceSync.refreshing} refreshError={workspaceSync.error} onRefresh={workspaceSync.refresh} onMeeting={upsert} />
                      {selected.documents.length ? (
                        <div className="document-grid">
                          {selected.documents.map((document) => (
                            <DocumentCard
                              key={document.id}
                              document={document}
                              onOpen={() => setDocumentId(document.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="workspace-empty">
                          <div className="empty-paper">
                            <div>
                              <FileText size={20} strokeWidth={1.4} />
                              <Sparkles size={15} />
                            </div>
                            <span />
                            <span />
                            <span />
                          </div>
                          <h3>
                            {selected.working
                              ? 'Sidekick is reviewing your discussion.'
                              : 'What would help your team move forward?'}
                          </h3>
                          <p>
                            {selected.working
                              ? 'Files will appear here when Sidekick creates a draft.'
                              : 'Describe your idea, then ask Sidekick to compare options or draft a plan.'}
                          </p>
                          <div className="example-prompt">
                            <span>TRY SAYING</span>“Sidekick, could you look
                            into a few ways we could approach this?”
                          </div>
                        </div>
                      )}
                      {selected.summary && (
                        <section className="summary-card">
                          <div className="summary-icon">
                            <Sparkles size={17} />
                          </div>
                          <div>
                            <h3>
                              {selected.phase === 'ended'
                                ? 'Where you landed'
                                : 'The thinking so far'}
                            </h3>
                            <div className="markdown compact-markdown">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                disallowedElements={['img']}
                              >
                                {selected.summary}
                              </ReactMarkdown>
                            </div>
                            <button
                              className="inline-link"
                              onClick={() => setTab('record')}
                            >
                              See the meeting record <ArrowRight size={13} />
                            </button>
                          </div>
                        </section>
                      )}
                      {selected.sources.length > 0 && (
                        <section className="sources-section">
                          <div className="section-heading">
                            <h2>Research sources</h2>
                            <span className="subtle-count">
                              {selected.sources.length} sources
                            </span>
                          </div>
                          <div className="source-list">
                            {selected.sources.map((source, index) => (
                              <a
                                key={`${source.url}-${index}`}
                                href={safeUrl(source.url)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <span className="source-number">
                                  {String(index + 1).padStart(2, '0')}
                                </span>
                                <span>
                                  <strong>{source.title}</strong>
                                  <small>{domain(source.url)}</small>
                                </span>
                                <ArrowUpRight size={15} />
                              </a>
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}
                  {tab === 'record' && (
                    <>
                      <div className="section-heading workspace-section-heading">
                        <div>
                          <h2>
                            {selected.recordDocument ? 'Meeting record' : 'Decisions and next steps'}<span>.</span>
                          </h2>
                          <p>
                            {selected.recordDocument ? 'The current workspace record and feedback.' : 'What’s settled, what’s open, and what comes next.'}
                          </p>
                        </div>
                        {selected.recordUrl && !selected.recordDocument && (
                          <a
                            className="inline-link"
                            href={safeUrl(selected.recordUrl)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Ambiguous <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                      {selected.recordDocument ? (
                        <>
                          <WorkspaceFile key={`${selected.id}-record`} meeting={selected} document={selected.recordDocument} targetId="record" refreshing={workspaceSync.refreshing} refreshError={workspaceSync.error} onRefresh={workspaceSync.refresh} onMeeting={upsert} />
                          <div className="workspace-record-data"><h3>Meeting data</h3><p>Decisions and next steps recorded from the conversation. Workspace feedback is reviewed separately.</p></div>
                        </>
                      ) : <WorkspaceToolbar meeting={selected} refreshing={workspaceSync.refreshing} refreshError={workspaceSync.error} onRefresh={workspaceSync.refresh} onMeeting={upsert} />}
                      {selected.summary && (
                        <div className="record-summary markdown">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            disallowedElements={['img']}
                          >
                            {selected.summary}
                          </ReactMarkdown>
                        </div>
                      )}
                      <div
                        className="record-tabs"
                        role="tablist"
                        aria-label="Meeting record categories"
                        onKeyDown={handleTabKeys}
                      >
                        {recordTabs.map((item) => (
                          <button
                            role="tab"
                            id={`record-tab-${item.id}`}
                            aria-controls={`record-panel-${item.id}`}
                            tabIndex={recordTab === item.id ? 0 : -1}
                            aria-selected={recordTab === item.id}
                            key={item.id}
                            className={recordTab === item.id ? 'active' : ''}
                            onClick={() => setRecordTab(item.id)}
                          >
                            {item.label}
                            <span>{selected[item.id].length}</span>
                          </button>
                        ))}
                      </div>
                      <div
                        role="tabpanel"
                        id={`record-panel-${recordTab}`}
                        aria-labelledby={`record-tab-${recordTab}`}
                      >
                        <RecordList
                          items={selected[recordTab]}
                          empty={
                            recordTabs.find((item) => item.id === recordTab)!
                              .empty
                          }
                          type={recordTab}
                        />
                      </div>
                      <div className="record-save-note">
                        <FolderOpen size={14} />
                        {selected.recordSaveStatus === 'saved'
                          ? 'Meeting record saved to Ambiguous AI.'
                          : selected.recordSaveStatus === 'saving'
                            ? 'Saving meeting record to your workspace…'
                            : selected.recordSaveStatus === 'failed'
                              ? 'Workspace save failed. The local meeting record is preserved.'
                              : 'Meeting record is stored locally.'}
                      </div>
                    </>
                  )}
                  {tab === 'transcript' && (
                    <>
                      <div className="section-heading workspace-section-heading">
                        <div>
                          <h2>
                            Meeting transcript<span>.</span>
                          </h2>
                          <p>Spoken and typed messages from this meeting.</p>
                        </div>
                        <span className="subtle-count">
                          {selected.mode === 'demo'
                            ? 'Scripted demo'
                            : 'Shared microphone'}
                        </span>
                      </div>
                      {selected.transcript.length ? (
                        <div className="transcript-list">
                          {selected.transcript.map((message) => (
                            <div
                              key={message.id}
                              className={`transcript-message ${message.role}`}
                            >
                              <span className="transcript-avatar">
                                {message.role === 'assistant' ? (
                                  <BrandMark small />
                                ) : (
                                  <AudioLines size={17} />
                                )}
                              </span>
                              <div>
                                <div className="transcript-meta">
                                  <strong>
                                    {message.role === 'assistant'
                                      ? 'Sidekick'
                                      : 'Participant'}
                                  </strong>
                                  <time>
                                    {new Date(message.at).toLocaleTimeString(
                                      undefined,
                                      { hour: '2-digit', minute: '2-digit' },
                                    )}
                                  </time>
                                </div>
                                <p>{message.text}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="record-empty">
                          <AudioLines size={27} strokeWidth={1.2} />
                          <p>
                            Your conversation will appear here as you talk or
                            add thoughts in writing.
                          </p>
                        </div>
                      )}
                      <p className="transcript-note">
                        {selected.mode === 'demo'
                          ? 'This conversation is simulated to demonstrate how the workspace evolves.'
                          : 'The transcript may miss or mishear speech. Speakers are not automatically identified.'}
                      </p>
                    </>
                  )}
                </section>
                {selectedFailure && (
                  <div className="meeting-error">
                    <AlertCircle size={17} />
                    <div>
                      <strong>Sidekick could not finish an update.</strong>
                      <p>{selectedFailure}</p>
                    </div>
                    <button
                      className="button secondary compact"
                      disabled={!!busy || selected.working}
                      onClick={() =>
                        void run('retry', async () =>
                          upsert(await api.retry(selected.id)),
                        )
                      }
                    >
                      {busy === 'retry' ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        'Retry'
                      )}
                    </button>
                  </div>
                )}
                {selected.phase === 'active' ? (
                  <form
                    className="contribution-form"
                    onSubmit={(event) => void sendContribution(event)}
                  >
                    <div className="contribution-field">
                      <span className="contribution-icon">
                        <MessageSquare size={18} strokeWidth={1.6} />
                      </span>
                      <textarea
                        aria-label="Add a thought to the meeting"
                        placeholder="A thought, a question, a change of direction…"
                        value={contribution}
                        onChange={(event) =>
                          setContribution(event.target.value)
                        }
                        rows={1}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                      />
                      <button
                        className="send-button"
                        type="submit"
                        disabled={!contribution.trim() || !!busy}
                        aria-label="Add to the conversation"
                      >
                        {busy === 'contribute' ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <ArrowUp size={18} />
                        )}
                      </button>
                    </div>
                    <div className="contribution-caption">
                      <span>Add to the conversation in writing.</span>
                      <span>
                        ↵ to share <i>·</i> Shift ↵ for a new line
                      </span>
                    </div>
                  </form>
                ) : (
                  <div className="meeting-finished">
                    <CircleCheck size={18} />
                    <span>
                      {selected.phase === 'closing'
                        ? 'Finishing current tasks and preparing the meeting record.'
                        : 'Meeting ended. Review your files and record, or export a copy.'}
                    </span>
                    {selected.recordUrl && (
                      <a
                        href={safeUrl(selected.recordUrl)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Ambiguous <ArrowUpRight size={14} />
                      </a>
                    )}
                  </div>
                )}
              </div>
              <ActivityPanel meeting={selected} />
            </div>
          </main>
        )}
      </div>

      {settings && (
        <Modal title="Integrations" onClose={() => setSettings(false)}>
          <p className="modal-description">
            Check the services Sidekick uses for voice, research, and saving files.
          </p>
          <div className="integration-list">
            {config?.integrations.map((integration) => (
              <div className="integration-item" key={integration.id}>
                <span className="integration-icon">
                  {integration.id.toLowerCase().includes('exa') ? (
                    <Search size={20} />
                  ) : integration.id.toLowerCase().includes('ambiguous') ? (
                    <FolderOpen size={20} />
                  ) : (
                    <Sparkles size={20} />
                  )}
                </span>
                <div>
                  <h3>{integration.name}</h3>
                  <p>{integration.description}</p>
                </div>
                <span
                  className={`status-pill ${integration.configured ? 'success' : 'warning'}`}
                >
                  {integration.configured ? (
                    <>
                      <Check size={12} /> Configured
                    </>
                  ) : (
                    'Not configured'
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="settings-note">
            <Settings2 size={17} />
            <p>
              “Configured” means an API key has been added. It does not confirm the service is accessible.
              To add a connection, set its key in <code>.env.local</code> on the server.
              Demo meetings use sample content and save only in this app.
            </p>
          </div>
          {config?.workspaceUrl && (
            <a
              className="button secondary full-width"
              href={safeUrl(config.workspaceUrl)}
              target="_blank"
              rel="noreferrer"
            >
              Open Ambiguous AI <ArrowUpRight size={16} />
            </a>
          )}
          <button
            className="button primary full-width"
            onClick={() =>
              void run('config', async () => setConfig(await api.config()))
            }
            disabled={!!busy}
          >
            {busy === 'config' ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{' '}
            Refresh status
          </button>
        </Modal>
      )}
      {opened && (
        <Modal
          title={opened.document.title}
          wide
          onClose={() => setDocumentId(null)}
        >
          <WorkspaceFile key={opened.document.id} meeting={opened.meeting} document={opened.document} refreshing={workspaceSync.refreshing} refreshError={workspaceSync.error} onRefresh={workspaceSync.refresh} onMeeting={upsert} />
        </Modal>
      )}
    </div>
  );
}

function safeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

function domain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function handleTabKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ];
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[next]?.focus();
  buttons[next]?.click();
}
