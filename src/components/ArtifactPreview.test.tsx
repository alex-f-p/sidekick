import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkDocument } from '../../shared/types';
import { ArtifactPreview, artifactFormat, artifactSearchText } from './ArtifactPreview';

const document: WorkDocument = {
  id: 'preview', key: 'preview', title: 'Team plan', kind: 'plan', content: 'Context remains available.',
  status: 'draft', saveStatus: 'local', version: 1, updatedAt: '2026-09-12T00:00:00.000Z',
};

describe('native artifact preview', () => {
  it('preserves older documents as ordinary narrative documents', () => {
    expect(artifactFormat(document)).toBe('document');
    expect(renderToStaticMarkup(<ArtifactPreview document={document} />)).toBe('');
  });

  it('shows slide content, navigation and notes while safely rendering user text', () => {
    const presentation: WorkDocument = {
      ...document, format: 'presentation', presentation: { slides: [
        { title: 'The next step', bullets: ['Ask the team', '<script>alert(1)</script>'], notes: 'Keep the decision open.' },
        { title: 'An alternative', bullets: ['Test demand first'] },
      ] },
    };
    const html = renderToStaticMarkup(<ArtifactPreview document={presentation} />);
    expect(html).toContain('Slide 1 of 2: The next step');
    expect(html).toContain('Ask the team');
    expect(html).toContain('Keep the decision open.');
    expect(html).toContain('aria-label="Next slide"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(artifactSearchText(presentation)).toContain('test demand first');
  });

  it('preserves zero, false, blank cells and formulas using native header row numbers', () => {
    const spreadsheet: WorkDocument = {
      ...document, format: 'spreadsheet', spreadsheet: { sheets: [
        { name: 'Budget', columns: [
          { key: 'cost', label: 'Cost', type: 'currency' },
          { key: 'agreed', label: 'Agreed', type: 'boolean' },
          { key: 'owner', label: 'Owner', type: 'text' },
          { key: 'total', label: 'Total', type: 'formula' },
        ], rows: [{ cost: 0, agreed: false, owner: null, total: '=SUM(A1:A1)' }] },
        { name: 'Open questions', columns: [{ key: 'question', label: 'Question', type: 'text' }], rows: [{ question: 'Confirm venue' }] },
      ] },
    };
    const html = renderToStaticMarkup(<ArtifactPreview document={spreadsheet} />);
    expect(html).toContain('<span>0</span>');
    expect(html).toContain('>False</span>');
    expect(html).toContain('aria-label="Empty cell"');
    expect(html).toContain('Row 1: column headings');
    expect(html).toContain('class="sheet-row-number">2</th>');
    expect(html).toContain('=SUM(A2:A2)');
    expect(html).toContain('Results are calculated in the workspace.');
    expect(html).toContain('Open questions');
    expect(html).not.toContain('$0');
    expect(artifactSearchText(spreadsheet)).toContain('confirm venue');
  });

  it('bounds large table rendering while keeping later rows searchable', () => {
    const spreadsheet: WorkDocument = {
      ...document, format: 'spreadsheet', spreadsheet: { sheets: [{
        name: 'Items', columns: [{ key: 'item', label: 'Item', type: 'text' }],
        rows: Array.from({ length: 101 }, (_, index) => ({ item: `Entry ${String(index + 1).padStart(3, '0')}` })),
      }] },
    };
    const html = renderToStaticMarkup(<ArtifactPreview document={spreadsheet} />);
    expect(html).toContain('Entry 100');
    expect(html).not.toContain('Entry 101');
    expect(html).toContain('1–100 of 101');
    expect(html).toContain('aria-label="Next rows"');
    expect(artifactSearchText(spreadsheet)).toContain('entry 101');
  });

  it('keeps imported worksheet row numbers and formulas in their native coordinates', () => {
    const spreadsheet: WorkDocument = {
      ...document, format: 'spreadsheet', spreadsheet: { nativeCoordinates: true, sheets: [{
        name: 'Budget', columns: [{ key: 'a', label: 'A', type: 'text' }, { key: 'b', label: 'B', type: 'formula' }],
        rows: [{ a: 'Price', b: 'Total' }, { a: 0, b: '=SUM(A2:A2)' }, { a: null, b: false }],
      }] },
    };
    const html = renderToStaticMarkup(<ArtifactPreview document={spreadsheet} />);
    expect(html).toContain('Row numbers match Ambiguous.');
    expect(html).toContain('class="sheet-row-number">1</th>');
    expect(html).toContain('class="sheet-row-number">3</th>');
    expect(html).toContain('=SUM(A2:A2)');
    expect(html).toContain('<span>Total</span>');
    expect(html).not.toContain('=SUM(A3:A3)');
    expect(html).not.toContain('Row 1: column headings');
    expect(html).toContain('<span>0</span>');
    expect(html).toContain('>False</span>');
    expect(html).toContain('aria-label="Empty cell"');
  });
});
