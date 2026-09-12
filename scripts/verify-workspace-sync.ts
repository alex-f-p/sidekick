/** Own synthetic files only: real native edits, comments, GPT-6 feedback, review. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { ArtifactContent, WorkDocument } from '../shared/types';
import { newMeeting } from '../server/domain';
import { MeetingStore, type StoredMeeting } from '../server/store';
import { MeetingWorker } from '../server/worker';
import { AgentsProvider } from '../server/providers/agents';
import { ExaProvider } from '../server/providers/exa';
import { AmbiguousProvider } from '../server/providers/ambiguous';
import { artifactContent } from '../server/workspace-sync';

const store = new MeetingStore('.sidekick/workspace-sync-verification');
const workspace = new AmbiguousProvider();
const agents = new AgentsProvider();
let modelCalls = 0;
const worker = new MeetingWorker(store, {
  workspace, exa:new ExaProvider(),
  agents:{analyze:async input => { modelCalls++; return agents.analyze(input); }},
});
const meeting: StoredMeeting = process.env.RESUME_SYNC_MEETING ? store.get(process.env.RESUME_SYNC_MEETING) : newMeeting('live');
meeting.title = 'Synthetic workspace sync verification';
store.save(meeting);
console.log(`Synthetic sync meeting: ${meeting.id}`);
const drafts: ArtifactContent[] = [
  {title:'Synthetic sync — event plan',kind:'plan',format:'document',status:'draft',content:'# Synthetic event plan\n\nTwo kits are planned at USD 12 each.\n\nInsurance and the event date remain unresolved.'},
  {title:'Synthetic sync — volunteer briefing',kind:'proposal',format:'presentation',status:'draft',content:'A two-slide synthetic volunteer briefing.',presentation:{slides:[{title:'Synthetic event proposal',bullets:['Two kits are planned.','Kit unit cost is USD 12.'],notes:'Synthetic verification. No real commitments.'},{title:'Open questions',bullets:['Insurance is unresolved.','Event date is unresolved.'],notes:'No owners assigned.'}]}},
  {title:'Synthetic sync — budget',kind:'plan',format:'spreadsheet',status:'draft',content:'Known kit costs in USD; insurance is unresolved.',spreadsheet:{sheets:[{name:'Budget',columns:[{key:'item',label:'Item',type:'text'},{key:'quantity',label:'Quantity',type:'number'},{key:'unit',label:'Unit cost (USD)',type:'currency'},{key:'total',label:'Known total (USD)',type:'formula'}],rows:[{item:'Kits',quantity:2,unit:12,total:'=B1*C1'},{item:'Insurance unresolved',quantity:null,unit:null,total:null}]}]}},
];
for (const [index,draft] of drafts.entries()) {
  if (meeting.documents[index]) continue;
  const document: WorkDocument = {...draft,id:randomUUID(),key:['plan','briefing','budget'][index],version:0,saveStatus:'local',updatedAt:new Date().toISOString()};
  meeting.documents.push(document);
  const saved = await workspace.save(draft);
  worker.workspaceSync.acceptSaved(meeting,document,saved,draft);
}
const [plan,deck,sheet] = meeting.documents;
async function nativePatch(path: string, body: unknown) {
  const response = await fetch(`https://app.ambiguous.ai/api${path}`, {method:'PATCH',headers:{Authorization:`Bearer ${process.env.AMBIGUOUS_API_KEY}`,'Content-Type':'application/json','API-Version':'1'},body:JSON.stringify(body)});
  if (!response.ok) throw new Error(`Synthetic native edit failed (${response.status}): ${(await response.text()).slice(0,300)}`);
  return response.json();
}
// Simulate a collaborator via native cell/title/ProseMirror edits on these new files.
await nativePatch(`/sheets/${sheet.externalId}/cells`,{cells:[{row:1,column:'C',value:18}]});
await nativePatch(`/documents/${sheet.externalId}`,{title:'Synthetic sync — collaborator budget'});
const planSnapshot = await workspace.get(plan.externalId!);
const nativePlan = JSON.parse(planSnapshot.content!);
nativePlan.content.push({type:'paragraph',content:[{type:'text',text:'Human note: keep the venue accessible.',marks:[{type:'bold'}]}]});
await nativePatch(`/documents/${plan.externalId}`,{content:JSON.stringify(nativePlan)});
await workspace.createComment(sheet.externalId!,'Synthetic verification feedback: the kit unit cost was corrected to USD 18. Please update the existing volunteer briefing to state USD 18 per kit and USD 36 for two kits. Keep the budget and human notes intact. This is draft feedback, not a team decision.');
await worker.workspaceSync.refresh(meeting.id,{force:true});
assert.equal(sheet.title,'Synthetic sync — collaborator budget');
assert.equal(sheet.spreadsheet!.nativeCoordinates,true);
assert.equal(sheet.spreadsheet!.sheets[0].rows[1].C,18);
assert.equal(sheet.spreadsheet!.sheets[0].rows[1].D,'=B2*C2');
assert(plan.content.includes('**Human note: keep the venue accessible.**'));
assert(sheet.workspace?.comments?.some(comment=>comment.content.includes('USD 36')));
console.log('Native title, cell, exact formula, bold human note, and comment imported.');
meeting.transcript.push({id:randomUUID(),role:'user',text:'This is a synthetic verification. Prepare the existing briefing from the current workspace budget and its collaborator feedback. There are two kits. Preserve the current budget inputs, human notes, stable file keys and formats. Revise only the briefing with the corrected cost and computed total. Keep insurance and date unresolved. No team decisions or owners are established. Use no research and create no additional files.',at:new Date().toISOString()});
meeting.revision++;
store.save(meeting);
await worker.run(meeting.id);
assert(!meeting.error,meeting.error);
assert.equal(deck.saveStatus,'saved',deck.error);
assert.equal(meeting.documents.length,3);
assert(JSON.stringify(deck.presentation).includes('18'),'Briefing omitted corrected unit cost');
assert(JSON.stringify(deck.presentation).includes('36'),'Briefing omitted corrected total');
assert.equal((await workspace.get(sheet.externalId!)).title,sheet.title);
assert((await workspace.get(plan.externalId!)).content!.includes('keep the venue accessible'));
assert.equal(meeting.decisions.length,0);
console.log('Real GPT-6 used the imported feedback in the same native briefing; human edits and decision boundaries survived.');
meeting.phase='closing'; meeting.revision++; store.save(meeting);
await worker.run(meeting.id);
assert.equal(meeting.phase,'ended');
assert.equal(meeting.recordSaveStatus,'saved');
const callsBefore = modelCalls;
await nativePatch(`/documents/${deck.externalId}`,{title:'Synthetic sync — edited after meeting'});
await worker.refreshWorkspace(meeting.id,{force:true});
assert.equal(deck.title,'Synthetic sync — edited after meeting');
assert.equal(meeting.phase,'ended');
assert.equal(modelCalls,callsBefore);
console.log('Ended-meeting refresh imported edits without another model call.');
// Review a proposed overlapping cell edit against a current version, then reject stale review.
const source = structuredClone(artifactContent(sheet));
const proposed = structuredClone(source); proposed.spreadsheet!.sheets[0].rows[1].C=20;
worker.workspaceSync.stage(meeting,sheet,proposed,source,'Synthetic review: unit cost proposal.');
await worker.workspaceSync.refresh(meeting.id,{force:true});
const staleVersion=sheet.workspace!.version!,draftId=sheet.pendingDraft!.id;
await nativePatch(`/sheets/${sheet.externalId}/cells`,{cells:[{row:1,column:'C',value:19}]});
await assert.rejects(worker.resolveWorkspaceDraft(meeting.id,sheet.id,{action:'apply-draft',draftId,workspaceVersion:staleVersion}),/changed/);
assert.equal(sheet.spreadsheet!.sheets[0].rows[1].C,19);
assert(sheet.pendingDraft);
await worker.resolveWorkspaceDraft(meeting.id,sheet.id,{action:'apply-draft',draftId,workspaceVersion:sheet.workspace!.version!});
assert.equal(sheet.spreadsheet!.sheets[0].rows[1].C,20);
assert.equal(sheet.spreadsheet!.sheets[0].rows[1].D,'=B2*C2');
assert(!sheet.pendingDraft);
console.log('Stale review rejected; refreshed explicit Apply updated only the reviewed input and retained formulas.');
worker.updateFromWorkspace(meeting.id);
await worker.run(meeting.id);
assert.equal(meeting.phase,'ended');
assert(modelCalls>callsBefore);
assert.equal(meeting.recordSaveStatus,'saved');
for (const document of meeting.documents) {
  if (document.saveStatus !== 'saved') assert(document.pendingDraft && document.workspace?.status === 'conflict','An unsaved result must remain a separate reviewable proposal');
}
const report={meetingId:meeting.id,dataDirectory:'.sidekick/workspace-sync-verification',modelCalls,recordUrl:meeting.recordUrl,documents:meeting.documents.map(({id,title,format,url,version,saveStatus,pendingDraft})=>({id,title,format,url,version,saveStatus,pendingReview:Boolean(pendingDraft)})),checks:['Native title/cell/ProseMirror edit import','Exact native formula coordinates','Native comments into real GPT-6 context','Related briefing same-ID revision','No invented collective decision','Ended refresh without AI work','Stale conflict review rejection','Explicit reviewed cell merge','Explicit ended feedback update']};
writeFileSync('.sidekick/workspace-sync-verification-result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
