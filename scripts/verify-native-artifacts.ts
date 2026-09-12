/** Requires the running local server. Creates clearly labeled synthetic native work. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import type { Meeting, DocumentFormat } from "../shared/types";
import { AmbiguousProvider } from "../server/providers/ambiguous";

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
  const until = Date.now() + 300000;
  while (Date.now() < until) {
    const meeting = await request(`/meetings/${id}`);
    if (!meeting.working && meeting.error) throw new Error(meeting.error);
    if (!meeting.working && meeting.processedRevision >= meeting.revision)
      return meeting;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(
    "Native artifact verification timed out; inspect this meeting in Sidekick.",
  );
}
function session(id: string): string {
  return JSON.parse(readFileSync(`.sidekick/${id}.json`, "utf8"))
    .agentSessionId;
}

const meeting = await request("/meetings", { mode: "live" });
console.log(`Synthetic native artifact meeting: ${meeting.id}`);
await request(`/meetings/${meeting.id}/transcript`, {
  role: "user",
  text: "This is a synthetic Sidekick native artifact verification, not a real meeting or commitment. Title the meeting Native artifact verification. Create exactly three useful draft artifacts, all titled with Synthetic verification: a short written event plan, a two-slide presentation briefing for event volunteers with presenter notes, and a spreadsheet budget. The spreadsheet must include a Budget tab and an Open questions tab. Known test inputs are two kits at USD 12 each, zero venue cost because the test venue is donated, and unknown insurance cost that must stay blank and explicitly unresolved. Use a formula for kit quantity times unit cost. Keep monetary inputs numeric and label USD. In the Open questions tab include insurance availability as a boolean false (not confirmed) and a blank owner. In both the plan and deck state that insurance and the event date are unresolved. No owners or dates are assigned. Do not research or invent facts; use only these synthetic inputs.",
});
let current = await ready(meeting.id);
const firstSession = session(meeting.id);
const formats: DocumentFormat[] = ["document", "presentation", "spreadsheet"];
const originals = structuredClone(current.documents);
const provider = new AmbiguousProvider();
for (const format of formats) {
  const doc = current.documents.find(
    (doc) => (doc.format ?? "document") === format,
  );
  assert(doc, `Missing ${format}`);
  assert.equal(doc.saveStatus, "saved", `${format} save failed: ${doc.error}`);
  const stored = await provider.get(doc.externalId!);
  assert.equal(
    stored.type,
    format === "presentation"
      ? "slide"
      : format === "spreadsheet"
        ? "sheet"
        : "doc",
  );
  assert(stored.content, `${format} has no canonical content`);
}
assert.equal(
  current.documents.length,
  3,
  "Expected exactly three requested artifacts",
);
const workbook = current.documents.find(
  (doc) => doc.format === "spreadsheet",
)!.spreadsheet!;
assert(workbook.sheets.length >= 2, "Workbook tabs were lost");
const values = workbook.sheets.flatMap((sheet) =>
  sheet.rows.flatMap((row) => Object.values(row)),
);
assert(
  values.some((value) => typeof value === "string" && value.startsWith("=")),
  "No calculated formula",
);
for (const value of [12, 2, 0, null, false])
  assert(values.includes(value), `Missing typed input ${value}`);
assert(
  current.followUps.every((item) => !item.owner),
  "An owner was invented",
);
console.log(
  "Three native formats, two sheet tabs, formulas, blanks, zero, false, and unassigned work passed.",
);

await request(`/meetings/${meeting.id}/transcript`, {
  role: "user",
  text: "For this synthetic verification only, revise the same three existing artifacts: use three kits instead of two, keeping the unit price USD 12. In the briefing, explicitly say that three kits are planned. Keep insurance cost blank, date unresolved, and owners unassigned. Retain the same artifact keys and formats. Do not create additional artifacts or run research.",
});
current = await ready(meeting.id);
assert.equal(
  session(meeting.id),
  firstSession,
  "Managed agent session changed during revision",
);
assert.equal(current.documents.length, 3);
for (const original of originals) {
  const revised = current.documents.find((doc) => doc.id === original.id);
  assert(revised, "Artifact identity was lost");
  assert.equal(
    revised.externalId,
    original.externalId,
    "Native resource ID changed",
  );
  assert(
    revised.version > original.version,
    `${original.format} was not revised`,
  );
  assert.equal(revised.saveStatus, "saved", revised.error);
}
console.log("Same-session revisions retained all three native resource IDs.");
await request(`/meetings/${meeting.id}/close`, {});
current = await ready(meeting.id);
assert.equal(current.phase, "ended");
assert.equal(current.recordSaveStatus, "saved");
const record = await provider.get(
  JSON.parse(readFileSync(`.sidekick/${meeting.id}.json`, "utf8"))
    .recordExternalId,
);
for (const doc of current.documents)
  assert(
    record.content?.includes(doc.externalId!),
    "Handover omitted a native artifact link",
  );
const markdown = await (
  await fetch(`${base}/meetings/${meeting.id}/export`)
).text();
assert(
  markdown.includes("Speaker notes:"),
  "Local handover omitted presenter notes",
);
assert(
  markdown.includes("=") && markdown.includes("Budget"),
  "Local handover omitted spreadsheet work",
);
const report = {
  meetingId: meeting.id,
  recordUrl: current.recordUrl,
  documents: current.documents.map(
    ({ title, format, url, version, status, saveStatus }) => ({
      title,
      format,
      url,
      version,
      status,
      saveStatus,
    }),
  ),
  checks:
    "Real GPT-6 generated native Docs/Slides/Sheets; typed inputs, multi-tab workbook, formulas, same-session same-resource revisions, and saved handover passed. Formula results and visuals are inspected in the native browser separately.",
};
writeFileSync(
  ".sidekick/native-verification-result.txt",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
