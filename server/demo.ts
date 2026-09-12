import { randomUUID } from 'node:crypto';
import type { Meeting } from '../shared/types';
import { activity } from './domain';

const lines = [
  'We’re exploring a neighborhood repair café. Could you compare a monthly pop-up with a permanent space and draft a pilot proposal?',
  'I prefer a permanent space. Another concern from the room: we should test demand first, and we only have a $2,000 pilot budget. We haven’t agreed on the format yet.',
  'We agree to run one monthly pop-up as the pilot, with a maximum budget of $2,000. The permanent venue can wait. We still need to figure out insurance and who can host us. Please make a short team briefing deck and a planning budget sheet.',
  'Please wrap up. Contacting potential hosts and checking insurance are proposed next steps; nobody has committed to owning those yet.',
];
export function advanceDemo(meeting: Meeting) {
  if (meeting.demoStep >= 4 || meeting.phase !== 'active') return;
  const step = meeting.demoStep++;
  meeting.title = 'A neighborhood repair café';
  meeting.transcript.push({
    id: randomUUID(),
    role: 'user',
    text: lines[step],
    at: new Date().toISOString(),
  });
  meeting.revision++;
  meeting.processedRevision = meeting.revision;
  meeting.summary =
    'Exploring a welcoming neighborhood repair café that helps people repair everyday items, share practical skills, and reduce waste.';
  activity(
    meeting,
    'system',
    `Demo step ${step + 1} of 4`,
    [
      'Compare two event formats',
      'Add a budget limit',
      'The team makes a decision',
      'Review open questions and next steps',
    ][step],
  );
  if (step === 0) {
    meeting.documents.push({
      id: randomUUID(),
      key: 'format-comparison',
      kind: 'comparison',
      title: 'Pop-up or permanent space?',
      status: 'draft',
      saveStatus: 'local',
      version: 1,
      updatedAt: new Date().toISOString(),
      content:
        '# Pop-up or permanent space?\n\n> Simulated demo draft. These are illustrative assumptions, not findings from a live Exa search.\n\n## The choice\n\nStart a repair café in a borrowed community venue, or establish a dedicated space.\n\n| Consideration | Monthly pop-up | Permanent space |\n| --- | --- | --- |\n| Upfront cost | Lower; borrow a venue | Higher; lease and fit-out |\n| Learning | Test demand in small steps | Learn with a larger commitment |\n| Community presence | Recurring event | Consistent destination |\n| Volunteer needs | Bounded event shifts | Ongoing staffing |\n\n## Sidekick’s perspective\n\nA pop-up could make a useful first experiment. This is a suggestion; the team has not selected a format.\n\n## Questions to resolve\n\n- What budget is available?\n- Who could host a first event?\n- What insurance and safety arrangements would be needed?',
    });
    meeting.pending = [
      { id: randomUUID(), text: 'Choose the first event format.' },
      { id: randomUUID(), text: 'Establish a pilot budget.' },
    ];
    activity(
      meeting,
      'document',
      'Sample comparison drafted',
      'Sample content saved in Sidekick only.',
    );
  }
  if (step === 1) {
    meeting.ambiguities = [
      {
        id: randomUUID(),
        text: 'Permanent venue versus testing demand with a pop-up: both positions remain open.',
      },
    ];
    meeting.documents[0].content +=
      '\n\n## New constraint: $2,000 pilot budget\n\nThe room has introduced a $2,000 limit. A permanent space may be harder to fit within this amount; actual venue costs remain unverified. Both format preferences are preserved until the team decides.';
    meeting.documents[0].version++;
    activity(
      meeting,
      'thinking',
      'Both positions are still open',
      'Silence does not count as agreement.',
    );
  }
  if (step === 2) {
    meeting.decisions = [
      {
        id: randomUUID(),
        text: 'Run one monthly pop-up as the pilot, with a maximum budget of $2,000.',
        evidence:
          'We agree to run one monthly pop-up as the pilot, with a maximum budget of $2,000.',
      },
    ];
    meeting.ambiguities = [];
    meeting.pending = [
      { id: randomUUID(), text: 'Which venue can host the pilot?' },
      {
        id: randomUUID(),
        text: 'What insurance and safety arrangements are needed?',
      },
    ];
    meeting.documents[0].content +=
      '\n\n## Team decision\n\nProceed with one monthly pop-up, capped at $2,000. Defer the permanent venue. This decision replaces the earlier open choice.';
    meeting.documents[0].version++;
    meeting.documents.push({
      id: randomUUID(),
      key: 'pilot-proposal',
      kind: 'proposal',
      title: 'Repair café · pilot proposal',
      content:
        '# Repair café · pilot proposal\n\n> Simulated demo proposal. Budget allocations are planning assumptions for review.\n\n## Purpose\n\nTest local demand for a community repair café through one welcoming, practical event.\n\n## Agreed scope\n\nOne monthly pop-up pilot. Maximum total budget: $2,000. A permanent venue is deferred.\n\n## Draft event format\n\n- A short welcome and intake of repair requests.\n- Volunteer-supported repair tables, matched to the skills actually available.\n- A simple feedback conversation with visitors.\n\n## Illustrative budget\n\n| Item | Planning allowance |\n| --- | ---: |\n| Venue | $500 |\n| Tools and consumables | $650 |\n| Insurance and safety | $400 |\n| Signage and refreshments | $150 |\n| Contingency | $300 |\n| **Total** | **$2,000** |\n\nThese are unverified allowances, not supplier quotes or commitments.\n\n## Before confirming a date\n\nResolve the host venue and insurance requirements. Confirm volunteer skills and which items can be handled safely.\n\n## What to learn\n\nRecord attendance, types of repair requests, repairs completed, and interest in returning. The team has not set success targets or assigned owners.',
      status: 'draft',
      saveStatus: 'local',
      version: 1,
      updatedAt: new Date().toISOString(),
    });
    meeting.documents.push({
      id: randomUUID(),
      key: 'pilot-briefing',
      kind: 'proposal',
      format: 'presentation',
      title: 'Repair café · team briefing',
      content:
        '# Repair café · team briefing\n\n> Simulated demo presentation. The team decision is reflected in this draft; event details still need review.\n\nThe team agreed to one monthly pop-up pilot capped at $2,000 and deferred a permanent venue. This short briefing keeps the decision and unresolved questions together. Host venue, insurance arrangements, owners, and a date remain unconfirmed.',
      presentation: { slides: [
        {
          title: 'A small first step for a repair café',
          bullets: [
            'Run one monthly pop-up as the pilot.',
            'Keep the total budget within $2,000.',
            'Use the pilot to learn about local demand.',
            'Defer a permanent venue while the team learns.',
          ],
          notes: 'Simulated demo briefing. The pop-up format and $2,000 cap are the team’s stated decision. The learning approach is a draft suggestion; no attendance targets or event date have been agreed.',
        },
        {
          title: 'What needs an answer before we start',
          bullets: [
            'Find a venue willing and able to host.',
            'Confirm insurance and event safety requirements.',
            'Match repair tables to confirmed volunteer skills.',
            'Agree on owners and a date together.',
          ],
          notes: 'Venue outreach and insurance checks are proposed next steps. Nobody has accepted ownership. Planning allowances in the budget sheet are illustrative and unverified; they are not supplier quotes or spending commitments.',
        },
      ] },
      status: 'draft',
      saveStatus: 'local',
      version: 1,
      updatedAt: new Date().toISOString(),
    }, {
      id: randomUUID(),
      key: 'pilot-budget',
      kind: 'plan',
      format: 'spreadsheet',
      title: 'Repair café · pilot budget',
      content:
        '# Repair café · pilot budget\n\n> Simulated demo spreadsheet. These are illustrative planning allowances for review, not supplier quotes or commitments.\n\nThe proposed allowances total the agreed $2,000 cap. No spending is recorded and no budget items are committed in this demo. The second sheet keeps open questions visible; blank owner cells mean no owner has been assigned. Formula results are calculated when the spreadsheet is saved to the workspace.',
      spreadsheet: { sheets: [
        {
          name: 'Budget',
          columns: [
            { key: 'item', label: 'Item', type: 'text' },
            { key: 'allowance', label: 'Allowance ($)', type: 'currency' },
            { key: 'committed', label: 'Committed', type: 'boolean' },
            { key: 'note', label: 'Planning note', type: 'text' },
          ],
          rows: [
            { item: 'Venue', allowance: 500, committed: false, note: 'Illustrative allowance; host unconfirmed.' },
            { item: 'Tools and consumables', allowance: 650, committed: false, note: 'Review once volunteer skills are known.' },
            { item: 'Insurance and safety', allowance: 400, committed: false, note: 'Requirements and costs remain unverified.' },
            { item: 'Signage and refreshments', allowance: 150, committed: false, note: 'Illustrative allowance for review.' },
            { item: 'Contingency', allowance: 300, committed: false, note: 'Unallocated planning reserve.' },
            { item: 'Total allowance', allowance: '=SUM(B1:B5)', committed: null, note: 'Should fit the agreed $2,000 cap.' },
            { item: 'Spend recorded', allowance: 0, committed: false, note: 'No spending recorded in this simulated demo.' },
          ],
        },
        {
          name: 'Open questions',
          columns: [
            { key: 'question', label: 'Question', type: 'text' },
            { key: 'owner', label: 'Owner', type: 'text' },
            { key: 'resolved', label: 'Resolved', type: 'boolean' },
          ],
          rows: [
            { question: 'Which venue can host the pilot?', owner: null, resolved: false },
            { question: 'What insurance and safety arrangements are needed?', owner: null, resolved: false },
            { question: 'Which volunteer skills and repair activities are available?', owner: null, resolved: false },
          ],
        },
      ] },
      status: 'draft',
      saveStatus: 'local',
      version: 1,
      updatedAt: new Date().toISOString(),
    });
    activity(
      meeting,
      'decision',
      'Pilot direction confirmed',
      'The proposal now reflects the pop-up format and $2,000 cap.',
    );
    activity(
      meeting,
      'document',
      'Sample briefing and budget drafted',
      'Two slides and a budget with open questions are ready to preview. Simulated demo content stays local.',
    );
  }
  if (step === 3) {
    meeting.followUps = [
      {
        id: randomUUID(),
        text: 'Contact potential host venues.',
        status: 'proposed',
        owner: null,
      },
      {
        id: randomUUID(),
        text: 'Check insurance and event safety requirements.',
        status: 'proposed',
        owner: null,
      },
    ];
    meeting.summary +=
      ' The team agreed to a monthly pop-up pilot capped at $2,000 and deferred a permanent venue. Venue and insurance questions remain open; next steps are proposed and unassigned.';
    meeting.phase = 'ended';
    meeting.endedAt = new Date().toISOString();
    for (const document of meeting.documents) document.status = 'incomplete';
    activity(
      meeting,
      'document',
      'Demo meeting record ready',
      'Select Export meeting to download the record and drafts. Follow-ups still need owners.',
    );
  }
  for (const document of meeting.documents)
    document.updatedAt = new Date().toISOString();
}
