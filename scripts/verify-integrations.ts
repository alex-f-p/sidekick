/** Run with Sidekick's server active. Creates a labeled synthetic meeting and real workspace documents. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { Meeting } from "../shared/types";
const base = "http://127.0.0.1:3000/api";
async function request(path: string, body?: unknown): Promise<Meeting> {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as Meeting;
}
async function ready(id: string): Promise<Meeting> {
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    const meeting = await request(`/meetings/${id}`);
    if (!meeting.working && meeting.processedRevision >= meeting.revision)
      return meeting;
    if (!meeting.working && meeting.error) throw new Error(meeting.error);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("Meeting work timed out. Inspect its activity in Sidekick.");
}
const meeting = await request("/meetings", { mode: "live" });
console.log(`Synthetic integration meeting: ${meeting.id}`);
await request(`/meetings/${meeting.id}/transcript`, {
  text: "This is a synthetic Sidekick integration verification, not a real commitment. Please title the meeting Sidekick integration verification. We are considering a community repair cafe. Please research Repair Cafe International with Exa and draft one substantive options comparison of a monthly pop-up versus a permanent space. One participant prefers a permanent space; another wants a low-cost pop-up. We have not agreed on the format. The pilot budget is $2,000. No owners or dates have been assigned.",
  role: "user",
});
let current = await ready(meeting.id);
assert(current.sources.length > 0, "Exa sources were not retained");
assert(
  current.documents.some((doc) => doc.saveStatus === "saved"),
  "No substantive document was saved",
);
assert(current.ambiguities.length > 0, "Disagreement was not preserved");
assert(
  !current.decisions.some((item) =>
    /we (will|have decided)|choose.*permanent/i.test(item.text),
  ),
  "A format was falsely decided",
);
assert(
  current.followUps.every((item) => !item.owner),
  "An owner was invented",
);
const firstDocument = current.documents.find(
  (doc) => doc.saveStatus === "saved",
)!;
assert(
  current.documents.some((doc) =>
    current.sources.some((source) => doc.content.includes(source.url)),
  ),
  "Saved output omitted actual research citations",
);
console.log(
  `Research and first publication passed: ${current.sources.length} sources, ${current.documents.length} documents.`,
);
await request(`/meetings/${meeting.id}/transcript`, {
  text: "For this synthetic test, the team now explicitly agrees: choose the monthly pop-up, keep the total budget at $2,000, and defer the permanent space. Please revise the existing comparison to reflect that decision and keep venue and insurance unresolved. Do not run another search. Contacting venues is a proposed next step, with no assigned owner.",
  role: "user",
});
current = await ready(meeting.id);
assert(
  current.documents.some(
    (doc) => doc.id === firstDocument.id && doc.version > firstDocument.version,
  ),
  "The existing document was not revised",
);
assert(
  current.decisions.some((item) => /pop-up/i.test(item.text)),
  "The explicit decision is missing",
);
assert(
  current.followUps.every((item) => !item.owner),
  "A follow-up owner was invented",
);
assert(current.pending.length > 0, "Unresolved questions were lost");
console.log(
  "Same-session redirection, explicit decision, and document revision passed.",
);
await request(`/meetings/${meeting.id}/close`, {});
current = await ready(meeting.id);
assert.equal(current.phase, "ended");
assert.equal(current.recordSaveStatus, "saved");
const exportResponse = await fetch(`${base}/meetings/${meeting.id}/export`);
const markdown = await exportResponse.text();
for (const label of [
  "Summary",
  "Decisions made",
  "Open questions",
  "Uncertainties",
  "Follow-ups",
  "Files created",
])
  assert(markdown.includes(`## ${label}`), `Missing handover section ${label}`);
const report = {
  meetingId: meeting.id,
  recordUrl: current.recordUrl,
  documents: current.documents.map((d) => ({
    title: d.title,
    url: d.url,
    version: d.version,
    status: d.status,
    saveStatus: d.saveStatus,
  })),
  sources: current.sources.map((s) => s.url),
  checks:
    "Research, source citations, disagreement, redirection, same-document updates, unassigned follow-ups, and saved final handover passed. Browser audio is checked separately.",
};
writeFileSync(
  ".sidekick/verification-result.txt",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
