import { describe, expect, it } from 'vitest';
import {
  parseAnalysis,
  presentationSchema,
  safeSpreadsheetFormula,
  spreadsheetSchema,
  workDraftSchema,
} from './schema';

const document = {
  key: 'pilot',
  title: 'Pilot plan',
  kind: 'plan',
  content: 'A small neighborhood pilot.',
  status: 'draft',
};
const slide = { title: 'Start small', bullets: ['Test one neighborhood.'] };
const presentation = { slides: [slide] };
const sheet = {
  name: 'Budget',
  columns: [{ key: 'cost', label: 'Cost', type: 'currency' }],
  rows: [{ cost: 10 }],
};
const spreadsheet = { sheets: [sheet] };

describe('native work draft validation', () => {
  it('accepts an existing analysis containing an ordinary document without a format', () => {
    const result = parseAnalysis(JSON.stringify({
      title: 'Pilot',
      summary: 'Start with one neighborhood.',
      decisions: [],
      pending: [],
      ambiguities: [],
      followUps: [],
      documents: [document],
      researchQueries: [],
      spokenResponse: '',
    }));
    expect(result.documents).toEqual([document]);
  });

  it.each([
    ['document', {}],
    ['presentation', { presentation }],
    ['spreadsheet', { spreadsheet }],
  ])('accepts a %s with its matching native payload', (format, payload) => {
    expect(workDraftSchema.safeParse({ ...document, format, ...payload }).success).toBe(true);
  });

  it.each([
    ['missing slides', { format: 'presentation' }],
    ['missing sheets', { format: 'spreadsheet' }],
    ['slides in an ordinary document', { format: 'document', presentation }],
    ['sheets in an implicit ordinary document', { spreadsheet }],
    ['sheets in a presentation', { format: 'presentation', presentation, spreadsheet }],
    ['slides in a spreadsheet', { format: 'spreadsheet', spreadsheet, presentation }],
  ])('rejects a draft with %s', (_description, payload) => {
    expect(workDraftSchema.safeParse({ ...document, ...payload }).success).toBe(false);
  });

  it.each([
    ['no slides', { slides: [] }],
    ['too many slides', { slides: Array.from({ length: 17 }, () => slide) }],
    ['an empty title', { slides: [{ ...slide, title: '' }] }],
    ['too many bullets', { slides: [{ ...slide, bullets: Array(6).fill('Point') }] }],
    ['an oversized bullet', { slides: [{ ...slide, bullets: ['x'.repeat(241)] }] }],
    ['oversized speaker notes', { slides: [{ ...slide, notes: 'x'.repeat(4001) }] }],
  ])('rejects a presentation with %s', (_description, payload) => {
    expect(presentationSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    ['no sheets', { sheets: [] }],
    ['too many sheets', { sheets: Array.from({ length: 7 }, (_, index) => ({ ...sheet, name: `Sheet ${index}` })) }],
    ['duplicate sheet names regardless of case', { sheets: [sheet, { ...sheet, name: 'budget' }] }],
    ['an invalid sheet name', { sheets: [{ ...sheet, name: 'Costs/benefits' }] }],
    ['no columns', { sheets: [{ ...sheet, columns: [] }] }],
    ['too many columns', { sheets: [{ ...sheet, columns: Array.from({ length: 21 }, (_, index) => ({ key: `c${index}`, label: `Column ${index}`, type: 'text' })) }] }],
    ['duplicate column keys', { sheets: [{ ...sheet, columns: [...sheet.columns, ...sheet.columns] }] }],
    ['an unrecognized row key', { sheets: [{ ...sheet, rows: [{ cost: 10, hidden: 'Unexpected' }] }] }],
    ['no rows', { sheets: [{ ...sheet, rows: [] }] }],
    ['too many rows', { sheets: [{ ...sheet, rows: Array(201).fill({ cost: 10 }) }] }],
    ['a nested cell value', { sheets: [{ ...sheet, rows: [{ cost: { value: 10 } }] }] }],
    ['a non-finite number', { sheets: [{ ...sheet, rows: [{ cost: Infinity }] }] }],
    ['an oversized cell', { sheets: [{ ...sheet, rows: [{ cost: 'x'.repeat(3001) }] }] }],
  ])('rejects a spreadsheet with %s', (_description, payload) => {
    expect(spreadsheetSchema.safeParse(payload).success).toBe(false);
  });

  it('bounds total workbook size even when each sheet and cell fits its individual limit', () => {
    const payload = {
      sheets: [{ ...sheet, rows: Array.from({ length: 50 }, () => ({ cost: 'x'.repeat(2500) })) }],
    };
    const result = spreadsheetSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(issue => issue.message.includes('too large'))).toBe(true);
  });

  it('preserves false, zero, empty strings, null, and formulas without coercing their types', () => {
    const row = { enabled: false, quantity: 0, comment: '', estimate: null, total: '=SUM(B2:B3)' };
    const result = spreadsheetSchema.parse({
      sheets: [{
        name: 'Inputs',
        columns: [
          { key: 'enabled', label: 'Enabled', type: 'boolean' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'comment', label: 'Comment', type: 'text' },
          { key: 'estimate', label: 'Estimate', type: 'currency' },
          { key: 'total', label: 'Total', type: 'formula' },
        ],
        rows: [row],
      }],
    });
    expect(result.sheets[0].rows[0]).toEqual(row);
  });
});

describe('workbook formula boundary', () => {
  it.each([
    '=SUM(B2:B10)',
    '=round(AVERAGE($B$2:B3),2)',
    "='Budget Inputs'!B2*Summary!C2",
    "='Cafe''s A1 plan'!B1",
    '=IF(AND(B2>0,C2=TRUE),"Ready","Needs review")',
    '=IFERROR(B2/C2,0)',
    '=IF(B2=0,"WEBSERVICE(https://example.com)","Ready")',
  ])('permits local calculations and literal labels: %s', formula => {
    expect(safeSpreadsheetFormula(formula)).toBe(true);
    expect(spreadsheetSchema.safeParse({ sheets: [{ ...sheet, rows: [{ cost: formula }] }] }).success).toBe(true);
  });

  it.each([
    '=WEBSERVICE("https://example.com")',
    '=HYPERLINK("https://example.com","Open")',
    '=IMPORTXML("https://example.com","//title")',
    '=SUM(B2,UNSUPPORTED(B3))',
    "='[Other workbook.xlsx]Budget'!A1",
    "='https://example.com/budget'!A1",
    '=cmd|\' /C calc\'!A0',
    '=SUM(B2);RUN("command")',
    '=PrivateNamedRange',
  ])('rejects external references and unsupported execution: %s', formula => {
    expect(safeSpreadsheetFormula(formula)).toBe(false);
    expect(spreadsheetSchema.safeParse({ sheets: [{ ...sheet, rows: [{ cost: formula }] }] }).success).toBe(false);
  });
});
