import { describe, expect, it } from 'vitest';
import { newMeeting, applyAnalysis, meetingMarkdown } from './domain';
import type { Analysis } from '../shared/schema';
import type { WorkDocument } from '../shared/types';
const analysis: Analysis = {
  title: 'Neighborhood pilot',
  summary: 'Testing an event.',
  decisions: [],
  pending: [],
  ambiguities: [],
  followUps: [],
  documents: [],
  researchQueries: [],
  spokenResponse: '',
};
describe('meeting authority and handover', () => {
  it('never turns unsupported claims into a decision or named commitment', () => {
    const m = newMeeting('live');
    m.transcript.push({
      id: 't',
      role: 'user',
      text: 'Maybe Sam could help. We have not decided.',
      at: '',
    });
    applyAnalysis(m, {
      ...analysis,
      decisions: [
        { text: 'Launch on Monday.', evidence: 'We agreed to launch Monday.' },
      ],
      followUps: [
        {
          text: 'Organize the launch.',
          owner: 'Sam',
          status: 'agreed',
          evidence: 'Sam will organize the launch.',
        },
      ],
    });
    expect(m.decisions).toEqual([]);
    expect(m.pending[0].text).toContain('Needs confirmation');
    expect(m.followUps[0]).toMatchObject({ owner: null, status: 'proposed' });
  });
  it('ignores assistant speech as evidence and retains unresolved disagreement', () => {
    const m = newMeeting('live');
    m.transcript = [
      {
        id: 't',
        role: 'assistant',
        text: 'We agree to a permanent venue.',
        at: '',
      },
    ];
    applyAnalysis(m, {
      ...analysis,
      decisions: [
        { text: 'Permanent venue', evidence: 'We agree to a permanent venue.' },
      ],
      ambiguities: [{ text: 'Participants disagree about the venue.' }],
    });
    expect(m.decisions).toHaveLength(0);
    expect(m.ambiguities).toHaveLength(1);
  });
  it('records explicit evidence while keeping owners absent if never named in it', () => {
    const m = newMeeting('live');
    m.transcript = [
      {
        id: 't',
        role: 'user',
        text: 'We agree to run a pop-up. We will ask the venue about insurance.',
        at: '',
      },
    ];
    applyAnalysis(m, {
      ...analysis,
      decisions: [
        { text: 'Run a pop-up.', evidence: 'We agree to run a pop-up.' },
      ],
      followUps: [
        {
          text: 'Ask about insurance.',
          owner: 'Alex',
          status: 'agreed',
          evidence: 'We will ask the venue about insurance.',
        },
      ],
    });
    expect(m.decisions).toHaveLength(1);
    expect(m.followUps[0]).toMatchObject({ status: 'agreed', owner: null });
  });
  it('exports local drafts and failed writes truthfully alongside successful work', () => {
    const m = newMeeting('live');
    m.documents = [
      {
        id: 'd',
        key: 'plan',
        title: 'Pilot plan',
        kind: 'plan',
        content: '# Draft',
        status: 'incomplete',
        saveStatus: 'failed',
        version: 1,
        updatedAt: '',
        error: 'Network error',
      },
    ];
    const output = meetingMarkdown(m, true);
    expect(output).toContain('workspace save failed');
    expect(output).toContain('local copy only');
    expect(output).toContain('## Uncertainties');
    expect(output).toContain('## Follow-ups');
    expect(output).not.toContain('saved in Ambiguous AI');
  });

  it('includes every native slide, its speaker notes, and its confirmed workspace link in the full handover', () => {
    const m = newMeeting('live');
    m.documents = [{
      id: 'deck',
      key: 'pilot-deck',
      title: 'Pilot presentation',
      kind: 'proposal',
      format: 'presentation',
      content: 'A two-step pilot proposal.',
      presentation: { slides: [
        { title: 'The opportunity', bullets: ['A shared neighborhood venue.', 'Begin with a pop-up.'], notes: 'Ask participants what they need.\nLeave space for discussion.' },
        { title: 'The next step', bullets: ['Confirm venue availability.'], notes: 'No launch date has been agreed.' },
      ] },
      status: 'complete',
      saveStatus: 'saved',
      url: 'https://app.ambiguous.ai/slides/pilot-deck',
      version: 2,
      updatedAt: '',
    }];

    const output = meetingMarkdown(m, true);
    expect(output).toContain('[Pilot presentation](https://app.ambiguous.ai/slides/pilot-deck) — presentation; complete; saved in Ambiguous AI');
    expect(output).toContain('A two-step pilot proposal.');
    expect(output).toContain('## Slide 1: The opportunity\n\n- A shared neighborhood venue.\n- Begin with a pop-up.');
    expect(output).toContain('Speaker notes: Ask participants what they need.\nLeave space for discussion.');
    expect(output).toContain('## Slide 2: The next step\n\n- Confirm venue availability.');
    expect(output).toContain('Speaker notes: No launch date has been agreed.');

    const record = meetingMarkdown(m);
    expect(record).toContain('[Pilot presentation](https://app.ambiguous.ai/slides/pilot-deck)');
    expect(record).not.toContain('## Slide 1:');
  });

  it('retains all native sheets and rows, false and zero values, and uncalculated formulas after a failed save', () => {
    const m = newMeeting('live');
    const workbook: WorkDocument = {
      id: 'budget',
      key: 'pilot-budget',
      title: 'Pilot budget',
      kind: 'plan',
      format: 'spreadsheet',
      content: 'Amounts are provisional.',
      spreadsheet: { sheets: [
        {
          name: 'Inputs',
          columns: [
            { key: 'item', label: 'Item | description', type: 'text' },
            { key: 'cost', label: 'Cost', type: 'currency' },
            { key: 'confirmed', label: 'Confirmed', type: 'boolean' },
            { key: 'estimate', label: 'Estimate', type: 'number' },
          ],
          rows: [
            { item: 'Venue | community\nhall', cost: 0, confirmed: false, estimate: null },
            { item: 'Materials', cost: 25, confirmed: true, estimate: 10 },
          ],
        },
        {
          name: 'Totals',
          columns: [{ key: 'amount', label: 'Amount', type: 'formula' }],
          rows: [{ amount: '=SUM(Inputs!B1:B2)' }, { amount: '=ROUND(A1*1.1,2)' }],
        },
      ] },
      status: 'incomplete',
      saveStatus: 'failed',
      error: 'Workspace unavailable',
      version: 1,
      updatedAt: '',
    };
    m.documents = [workbook];

    const output = meetingMarkdown(m, true);
    expect(output).toContain('Pilot budget — spreadsheet; incomplete; workspace save failed; local copy only');
    expect(output).toContain('Amounts are provisional.');
    expect(output).toContain('## Inputs\n\n| Row | Item \\| description | Cost | Confirmed | Estimate |');
    expect(output).toContain('| 2 | Venue \\| community hall | 0 | false |  |');
    expect(output).toContain('| 3 | Materials | 25 | true | 10 |');
    expect(output).toContain('## Totals\n\n| Row | Amount |');
    expect(output).toContain('| 2 | =SUM(Inputs!B2:B3) |\n| 3 | =ROUND(A2*1.1,2) |');
    expect(output).toContain('Formula expressions are preserved; open the native spreadsheet to calculate them.');
    expect(output).not.toContain('saved in Ambiguous AI');
    expect(output).not.toContain('undefined');
    expect(workbook.spreadsheet?.sheets[0].rows[0]).toMatchObject({ cost: 0, confirmed: false, estimate: null });
    expect(workbook.spreadsheet?.sheets[1].rows).toEqual([
      { amount: '=SUM(Inputs!B1:B2)' },
      { amount: '=ROUND(A1*1.1,2)' },
    ]);
  });
});
