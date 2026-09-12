import { randomUUID } from 'node:crypto';
import type {
  Activity,
  Meeting,
  MeetingMode,
  RecordItem,
  WorkDocument,
} from '../shared/types';
import type { Analysis } from '../shared/schema';
import { shiftFormulaForHeader } from '../shared/spreadsheet';

export function newMeeting(mode: MeetingMode): Meeting {
  return {
    id: randomUUID(),
    title: 'Untitled conversation',
    mode,
    phase: 'active',
    startedAt: new Date().toISOString(),
    revision: 0,
    processedRevision: 0,
    working: false,
    summary: '',
    transcript: [],
    documents: [],
    decisions: [],
    pending: [],
    ambiguities: [],
    followUps: [],
    activity: [],
    sources: [],
    recordSaveStatus: 'local',
    demoStep: 0,
  };
}
export function activity(
  meeting: Meeting,
  kind: Activity['kind'],
  title: string,
  detail?: string,
) {
  meeting.activity.unshift({
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    title,
    detail,
  });
  meeting.activity = meeting.activity.slice(0, 100);
}
const normalize = (text: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').trim();
export function applyAnalysis(meeting: Meeting, analysis: Analysis) {
  const human = normalize(
    meeting.transcript
      .filter((t) => t.role === 'user')
      .map((t) => t.text)
      .join(' '),
  );
  const hasEvidence = (evidence: string) =>
    evidence.trim().length > 5 && human.includes(normalize(evidence));
  const identify = <T extends { text: string }>(
    items: T[],
    previous: RecordItem[],
  ) =>
    items.map((item) => ({
      ...item,
      id: previous.find((old) => old.text === item.text)?.id ?? randomUUID(),
    }));
  meeting.title = analysis.title;
  meeting.summary = analysis.summary;
  const ungrounded = analysis.decisions.filter(
    (item) => !hasEvidence(item.evidence),
  );
  meeting.decisions = identify(
    analysis.decisions.filter((item) => hasEvidence(item.evidence)),
    meeting.decisions,
  );
  meeting.pending = identify(
    [
      ...analysis.pending,
      ...ungrounded.map((item) => ({
        text: `Needs confirmation: ${item.text}`,
      })),
    ],
    meeting.pending,
  );
  meeting.ambiguities = identify(analysis.ambiguities, meeting.ambiguities);
  meeting.followUps = identify(
    analysis.followUps.map((item) => ({
      ...item,
      status: hasEvidence(item.evidence) ? item.status : ('proposed' as const),
      owner:
        item.owner &&
        hasEvidence(item.evidence) &&
        normalize(item.evidence).includes(normalize(item.owner))
          ? item.owner
          : null,
    })),
    meeting.followUps,
  );
  meeting.spokenResponse = analysis.spokenResponse;
}
export function meetingMarkdown(
  meeting: Meeting,
  includeDocuments = false,
): string {
  const list = (items: RecordItem[]) =>
    items.length
      ? items
          .map(
            (item) =>
              `- ${item.text}${item.status ? ` (${item.status})` : ''}${item.owner ? ` — ${item.owner}` : ''}${item.evidence ? `\n  Evidence: “${item.evidence}”` : ''}`,
          )
          .join('\n')
      : '- None recorded.';
  const work = meeting.documents.length
    ? meeting.documents
        .map(
          (doc) =>
            `- ${doc.url ? `[${doc.title}](${doc.url})` : doc.title} — ${doc.format ?? 'document'}; ${doc.status}; ${doc.saveStatus === 'saved' ? 'saved in Ambiguous AI' : `${doc.saveStatus === 'failed' ? 'workspace save failed; ' : ''}local copy only`}${doc.error ? ` (${doc.error})` : ''}`,
        )
        .join('\n')
    : '- No files created.';
  return `# ${meeting.title}\n\n${meeting.mode === 'demo' ? '> Simulated demo. Sample content saved only in Sidekick; no live research or external saves.\n\n' : ''}Started ${meeting.startedAt}\nStatus: ${meeting.phase}${meeting.error ? `\nIncomplete work: ${meeting.error}` : ''}\n\n## Summary\n\n${meeting.summary || 'The discussion has not yet been summarized.'}\n\n## Decisions made\n\n${list(meeting.decisions)}\n\n## Open questions\n\n${list(meeting.pending)}\n\n## Uncertainties\n\n${list(meeting.ambiguities)}\n\n## Follow-ups\n\n${list(meeting.followUps)}\n\n## Files created\n\n${work}\n\n## Sources\n\n${meeting.sources.map((s) => `- [${s.title}](${s.url})`).join('\n') || '- No external sources retrieved.'}\n${includeDocuments ? meeting.documents.map((d) => `\n---\n\n# ${d.title}\n\n${artifactMarkdown(d)}${d.pendingDraft ? `\n\n## Proposed AI draft — not applied\n\n${d.pendingDraft.reason ?? ''}\n\n${artifactMarkdown({...d,...d.pendingDraft})}` : ''}\n`).join('') : ''}`;
}

/** Keep the native work usable in the local handover even after a failed save. */
export function artifactMarkdown(document: WorkDocument): string {
  if (document.format === 'presentation' && document.presentation) {
    return `${document.content}\n\n${document.presentation.slides.map((slide, index) =>
      `## Slide ${index + 1}: ${slide.title}\n\n${slide.bullets.map(bullet => `- ${bullet}`).join('\n')}${slide.notes ? `\n\nSpeaker notes: ${slide.notes}` : ''}`,
    ).join('\n\n')}`;
  }
  if (document.format === 'spreadsheet' && document.spreadsheet) {
    const cell = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const nativeCoordinates = document.spreadsheet.nativeCoordinates;
    const dataCell = (value: unknown) => cell(typeof value === 'string' && !nativeCoordinates ? shiftFormulaForHeader(value) : value);
    return `${document.content}\n\n${document.spreadsheet.sheets.map(sheet =>
      `## ${sheet.name}\n\n| Row | ${sheet.columns.map(column => cell(column.label)).join(' | ')} |\n| --- | ${sheet.columns.map(() => '---').join(' | ')} |\n${sheet.rows.map((row, index) => `| ${index + (nativeCoordinates ? 1 : 2)} | ${sheet.columns.map(column => dataCell(row[column.key])).join(' | ')} |`).join('\n')}`,
    ).join('\n\n')}\n\nFormula expressions are preserved; open the native spreadsheet to calculate them.`;
  }
  return document.content;
}
