import { describe, expect, it } from 'vitest';
import type { ArtifactContent } from '../../shared/types';
import type { WorkspaceDocument } from './ambiguous';
import {
  mergeWorkspaceContent,
  projectWorkspaceDocument,
  WorkspaceMergeError,
} from './ambiguous-content';

const previous: ArtifactContent = {
  title: 'Pilot',
  kind: 'plan',
  status: 'draft',
  content: 'The earlier overview.',
};
const snapshot = (
  type: WorkspaceDocument['type'],
  canvas: unknown,
): WorkspaceDocument => ({
  id: 'native-1',
  title: 'Pilot',
  type,
  content: JSON.stringify(canvas),
});
const sheet = () => ({
  customWorkbookMetadata: { retained: true },
  namedRanges: [
    {
      name: 'PilotTotal',
      sheetName: 'Budget',
      startRow: 1,
      startCol: 2,
      endRow: 1,
      endCol: 2,
    },
  ],
  sheets: [
    {
      name: 'Budget',
      columns: [
        { id: 'A', name: 'Item', type: 'text', width: 250 },
        { id: 'B', name: 'Cost', type: 'currency', width: 180 },
        { id: 'C', name: 'Total', type: 'formula' },
      ],
      rows: [
        { A: 'Item', B: 'Cost', C: 'Total' },
        { A: 'Bread', B: 12, C: '=IF(B2="","Pending",B2*2)' },
        { A: 'Flour', B: null, C: false },
      ],
      cells: [
        {
          row: 1,
          col: 1,
          value: 12,
          format: { bold: true, backgroundColor: '#334455' },
          note: 'A human note',
        },
        {
          row: 1,
          col: 2,
          formula: '=IF(B2="","Pending",B2*2)',
          format: { italic: true },
        },
      ],
      charts: [{ id: 'chart-1', type: 'bar', range: 'A1:B3' }],
      merges: [{ startRow: 4, endRow: 4, startCol: 0, endCol: 2 }],
    },
  ],
});
const paragraph = (text: string, extra = {}) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...extra }],
});
const deck = () => ({
  settings: { aspectRatio: '16:9', theme: 'human-theme' },
  masterSlides: [{ id: 'master-1', elements: [] }],
  slides: [
    {
      id: 'slide-1',
      layout: { width: 960, height: 540 },
      background: '#112233',
      notes: 'Source https://example.com/verified',
      elements: [
        {
          id: 'slide-1-eyebrow',
          type: 'text',
          text: 'SIDEKICK',
          x: 64,
          y: 34,
          w: 600,
          h: 24,
        },
        {
          id: 'slide-1-title',
          type: 'text',
          text: 'Bakery pilot',
          x: 83,
          y: 99,
          w: 700,
          h: 80,
          color: '#FFFFFF',
          content: {
            type: 'doc',
            content: [paragraph('Bakery pilot', { marks: [{ type: 'bold' }] })],
          },
        },
        {
          id: 'slide-1-body',
          type: 'text',
          text: '• Rent 1200\n• Owner unresolved',
          x: 75,
          y: 220,
          w: 800,
          h: 240,
          fontSize: 28,
          content: {
            type: 'doc',
            content: [
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [
                      paragraph('Rent 1200', { marks: [{ type: 'italic' }] }),
                    ],
                  },
                  {
                    type: 'listItem',
                    content: [paragraph('Owner unresolved')],
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'photo-1',
          type: 'image',
          src: 'https://example.com/human-photo.png',
          x: 600,
          y: 60,
          w: 200,
          h: 100,
          crop: { x: 0.1, y: 0.2 },
        },
      ],
    },
  ],
});
const doc = () => ({
  type: 'doc',
  customMetadata: { retained: true },
  content: [
    {
      type: 'heading',
      attrs: { level: 2, blockId: 'heading-1' },
      content: [{ type: 'text', text: 'Pilot budget' }],
    },
    {
      type: 'paragraph',
      attrs: { blockId: 'cost-1', alignment: 'center' },
      content: [
        { type: 'text', text: 'Rent ' },
        {
          type: 'text',
          text: '1200',
          marks: [
            { type: 'bold' },
            { type: 'textStyle', attrs: { color: '#882211' } },
          ],
        },
        { type: 'text', text: ' per month.' },
      ],
    },
    {
      type: 'paragraph',
      attrs: { blockId: 'owner-1' },
      content: [{ type: 'text', text: 'Owner unresolved' }],
    },
    {
      type: 'image',
      attrs: {
        src: 'https://example.com/reference.png',
        alt: 'Reference',
        width: 550,
      },
    },
  ],
});

describe('canonical workspace projections', () => {
  it('projects native coordinates exactly, including headers, formulas, zero and false', () => {
    const raw = sheet();
    raw.sheets[0].rows[2].B = 0;
    const projected = projectWorkspaceDocument(
      snapshot('sheet', raw),
      previous,
    );
    expect(projected.previewLimited).toBe(false);
    expect(projected.spreadsheet?.nativeCoordinates).toBe(true);
    expect(
      projected.spreadsheet?.sheets[0].columns.map((column) => [
        column.key,
        column.label,
      ]),
    ).toEqual([
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C'],
    ]);
    expect(projected.spreadsheet?.sheets[0].rows).toEqual(raw.sheets[0].rows);
    expect(projected.content).not.toContain('earlier overview');
  });
  it('allows spare empty native columns without dropping their raw representation', () => {
    const raw = sheet();
    raw.sheets[0].columns.push({ id: 'D', name: 'D', type: 'text' });
    const saved = snapshot('sheet', raw);
    const projected = projectWorkspaceDocument(saved, previous);
    expect(projected.spreadsheet?.sheets[0].columns).toHaveLength(3);
    const next = structuredClone(projected);
    next.spreadsheet!.sheets[0].rows[1].B = 18;
    expect(
      JSON.parse(mergeWorkspaceContent(saved, projected, next)).sheets[0]
        .columns,
    ).toHaveLength(4);
  });
  it('prefers current rich text and preserves source notes in the slide preview', () => {
    const raw = deck();
    raw.slides[0].elements[1].text = 'Stale fallback';
    const projected = projectWorkspaceDocument(
      snapshot('slide', raw),
      previous,
    );
    expect(projected.presentation?.slides[0]).toEqual({
      title: 'Bakery pilot',
      bullets: ['Rent 1200', 'Owner unresolved'],
      notes: 'Source https://example.com/verified',
    });
    expect(projected.previewLimited).toBe(false);
  });
  it('projects rich document text, marks and embedded images without discarding the raw tree', () => {
    const saved = snapshot('doc', doc());
    const projected = projectWorkspaceDocument(saved, previous);
    expect(projected.content).toContain(
      '## Pilot budget\n\nRent **1200** per month.',
    );
    expect(projected.content).toContain(
      '![Reference](https://example.com/reference.png)',
    );
    expect(projected.previewLimited).toBe(false);
    expect(mergeWorkspaceContent(saved, projected, projected)).toBe(
      saved.content,
    );
  });
  it('marks unknown native bodies as limited and refuses to rebuild them', () => {
    const saved = snapshot('slide', {
      nativeFutureFormat: [{ chart: 'important' }],
    });
    const projected = projectWorkspaceDocument(saved, previous);
    expect(projected.previewLimited).toBe(true);
    expect(() =>
      mergeWorkspaceContent(saved, projected, {
        ...projected,
        content: 'New text',
      }),
    ).toThrow(WorkspaceMergeError);
  });
});

describe('native spreadsheet delta merging', () => {
  it('changes a numeric cell while preserving human styling, charts, notes, and unrelated edits', () => {
    const original = snapshot('sheet', sheet());
    const source = projectWorkspaceDocument(original, previous);
    const next = structuredClone(source);
    next.spreadsheet!.sheets[0].rows[1].B = 18;
    const current = sheet();
    current.sheets[0].rows[2].B = 7;
    const merged = JSON.parse(
      mergeWorkspaceContent(snapshot('sheet', current), source, next),
    );
    expect(merged.sheets[0].rows[1].B).toBe(18);
    expect(merged.sheets[0].rows[2].B).toBe(7);
    expect(merged.sheets[0].cells[0]).toEqual({
      ...current.sheets[0].cells[0],
      value: 18,
    });
    expect(merged.sheets[0].charts).toEqual(current.sheets[0].charts);
    expect(merged.sheets[0].merges).toEqual(current.sheets[0].merges);
    expect(merged.customWorkbookMetadata).toEqual(
      current.customWorkbookMetadata,
    );
    expect(merged.namedRanges).toEqual(current.namedRanges);
  });
  it('keeps native formulas exact and updates both row values and sparse cell formulas', () => {
    const saved = snapshot('sheet', sheet());
    const source = projectWorkspaceDocument(saved, previous);
    const next = structuredClone(source);
    next.spreadsheet!.sheets[0].rows[1].C = '=COUNTA(A1:A3)';
    const merged = JSON.parse(mergeWorkspaceContent(saved, source, next));
    expect(merged.sheets[0].rows[1].C).toBe('=COUNTA(A1:A3)');
    expect(merged.sheets[0].cells[1]).toEqual({
      ...sheet().sheets[0].cells[1],
      formula: '=COUNTA(A1:A3)',
    });
  });
  it('requires explicit review for a same-cell overlap and retains unrelated values when allowed', () => {
    const source = projectWorkspaceDocument(
      snapshot('sheet', sheet()),
      previous,
    );
    const next = structuredClone(source);
    next.spreadsheet!.sheets[0].rows[1].B = 18;
    const current = sheet();
    current.sheets[0].rows[1].B = 20;
    current.sheets[0].rows[2].B = 7;
    const saved = snapshot('sheet', current);
    expect(() => mergeWorkspaceContent(saved, source, next)).toThrow(
      'same field',
    );
    const merged = JSON.parse(mergeWorkspaceContent(saved, source, next, true));
    expect(merged.sheets[0].rows[1].B).toBe(18);
    expect(merged.sheets[0].rows[2].B).toBe(7);
  });
  it('rejects changed row count and reordered identities even with overwrite enabled', () => {
    const source = projectWorkspaceDocument(
      snapshot('sheet', sheet()),
      previous,
    );
    const next = structuredClone(source);
    next.spreadsheet!.sheets[0].rows[1].B = 18;
    const current = sheet();
    [current.sheets[0].rows[1], current.sheets[0].rows[2]] = [
      current.sheets[0].rows[2],
      current.sheets[0].rows[1],
    ];
    expect(() =>
      mergeWorkspaceContent(snapshot('sheet', current), source, next, true),
    ).toThrow('reordered');
    next.spreadsheet!.sheets[0].rows.push({ A: 'New row', B: 3, C: null });
    expect(() =>
      mergeWorkspaceContent(snapshot('sheet', sheet()), source, next, true),
    ).toThrow(WorkspaceMergeError);
  });
});

describe('native slide delta merging', () => {
  it('updates text and notes without regenerating layout, images, rich marks or masters', () => {
    const raw = deck();
    const saved = snapshot('slide', raw);
    const source = projectWorkspaceDocument(saved, previous);
    const next = structuredClone(source);
    next.presentation!.slides[0].bullets[0] = 'Rent 1500';
    next.presentation!.slides[0].notes =
      'Source https://example.com/verified; changed assumption.';
    const merged = JSON.parse(mergeWorkspaceContent(saved, source, next));
    expect(merged.slides[0].elements[2].text).toBe(
      '• Rent 1500\n• Owner unresolved',
    );
    expect(
      merged.slides[0].elements[2].content.content[0].content[0].content[0]
        .content[0],
    ).toEqual({ type: 'text', text: 'Rent 1500', marks: [{ type: 'italic' }] });
    expect(merged.slides[0].elements[3]).toEqual(raw.slides[0].elements[3]);
    expect(merged.slides[0].elements[2].x).toBe(75);
    expect(merged.slides[0].elements[2].fontSize).toBe(28);
    expect(merged.masterSlides).toEqual(raw.masterSlides);
    expect(merged.slides[0].notes).toBe(next.presentation!.slides[0].notes);
  });
  it('preserves a human note change while applying an unrelated text revision', () => {
    const source = projectWorkspaceDocument(
      snapshot('slide', deck()),
      previous,
    );
    const next = structuredClone(source);
    next.presentation!.slides[0].title = 'Focused bakery pilot';
    const current = deck();
    current.slides[0].notes = 'A human added context and a source.';
    const merged = JSON.parse(
      mergeWorkspaceContent(snapshot('slide', current), source, next),
    );
    expect(merged.slides[0].notes).toBe(current.slides[0].notes);
    expect(
      merged.slides[0].elements[1].content.content[0].content[0].marks,
    ).toEqual([{ type: 'bold' }]);
  });
  it('rejects structural slide rewrites instead of flattening a human-edited deck', () => {
    const saved = snapshot('slide', deck());
    const source = projectWorkspaceDocument(saved, previous);
    const next = structuredClone(source);
    next.presentation!.slides[0].bullets.push('Another point');
    expect(() => mergeWorkspaceContent(saved, source, next, true)).toThrow(
      WorkspaceMergeError,
    );
  });
});

describe('rich document delta merging', () => {
  it('edits an existing marked text leaf and retains native blocks, images and unrelated human text', () => {
    const source = projectWorkspaceDocument(snapshot('doc', doc()), previous);
    const next = { ...source, content: source.content.replace('1200', '1500') };
    const current = doc();
    current.content[2].content![0].text = 'Owner Bea';
    const merged = JSON.parse(
      mergeWorkspaceContent(snapshot('doc', current), source, next),
    );
    expect(merged.content[1].content[1].text).toBe('1500');
    expect(merged.content[1].content[1].marks).toEqual([
      { type: 'bold' },
      { type: 'textStyle', attrs: { color: '#882211' } },
    ]);
    expect(merged.content[1].attrs).toEqual(current.content[1].attrs);
    expect(merged.content[2].content[0].text).toBe('Owner Bea');
    expect(merged.content[3]).toEqual(current.content[3]);
    expect(merged.customMetadata).toEqual(current.customMetadata);
  });
  it('rejects a rewrite across formatting nodes or a new block', () => {
    const saved = snapshot('doc', doc());
    const source = projectWorkspaceDocument(saved, previous);
    expect(() =>
      mergeWorkspaceContent(saved, source, {
        ...source,
        content: source.content.replace(
          'Rent **1200** per month.',
          'A completely new paragraph.',
        ),
      }),
    ).toThrow(WorkspaceMergeError);
    expect(() =>
      mergeWorkspaceContent(saved, source, {
        ...source,
        content: source.content + '\n\n## New section',
      }),
    ).toThrow(WorkspaceMergeError);
  });
});
