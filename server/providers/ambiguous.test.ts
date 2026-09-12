import { describe, expect, it, vi } from 'vitest';
import { AmbiguousProvider, WorkspaceConflictError } from './ambiguous';
import { projectWorkspaceDocument } from './ambiguous-content';
import type {
  PresentationContent,
  SpreadsheetContent,
} from '../../shared/types';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
describe('Ambiguous AI verified publication', () => {
  it('creates, retains identity, and reads back the saved document before returning', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'doc-1', content: 'stored' }, 201))
      .mockResolvedValueOnce(
        response({ id: 'doc-1', content: 'stored', title: 'Test' }),
      );
    const onCreated = vi.fn();
    const saved = await new AmbiguousProvider('test', fetcher).save({
      title: 'Test',
      content: 'Markdown',
      onCreated,
    });
    expect(saved.id).toBe('doc-1');
    expect(onCreated).toHaveBeenCalledWith('doc-1');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      type: 'doc',
      visibility: 'workspace',
    });
  });
  it('preserves a human edit instead of replacing the workspace body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ id: 'doc-1', content: 'Human edit' }));
    await expect(
      new AmbiguousProvider('test', fetcher).save({
        id: 'doc-1',
        title: 'Test',
        content: 'New draft',
        lastContent: 'Previous content',
      }),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe('GET');
  });
  it('retains a created identity even if verification fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'doc-1' }, 201))
      .mockResolvedValueOnce(response({}, 503));
    const onCreated = vi.fn();
    await expect(
      new AmbiguousProvider('test', fetcher).save({
        title: 'Test',
        content: 'Draft',
        onCreated,
      }),
    ).rejects.toThrow('503');
    expect(onCreated).toHaveBeenCalledWith('doc-1');
  });
  it('does not report a failed write or empty read-back as saved', async () => {
    const rejected = vi.fn().mockResolvedValue(response({}, 403));
    await expect(
      new AmbiguousProvider('test', rejected).save({
        title: 'Test',
        content: 'Draft',
      }),
    ).rejects.toThrow('403');
    const empty = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'doc-1' }, 201))
      .mockResolvedValueOnce(response({ id: 'doc-1', content: '' }));
    await expect(
      new AmbiguousProvider('test', empty).save({
        title: 'Test',
        content: 'Draft',
      }),
    ).rejects.toThrow('empty');
  });
});

const presentation: PresentationContent = {
  slides: [
    {
      title: 'Bakery pilot',
      bullets: [
        'Two pastries, one focused menu.',
        'The opening date is still undecided.',
      ],
      notes: 'A proposal, not an agreed decision.',
    },
  ],
};
const spreadsheet: SpreadsheetContent = {
  sheets: [
    {
      name: 'Budget',
      columns: [
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'unit_cost', label: 'Unit cost', type: 'currency' },
        { key: 'total', label: 'Total', type: 'formula' },
      ],
      rows: [
        { item: 'Pastry', unit_cost: 12, total: '=B1*2' },
        { item: 'Flour', unit_cost: 4, total: '=SUM(B1:B2)' },
      ],
    },
  ],
};

// Emulate native read APIs enriching the stored canvas instead of echoing the write.
function nativeWorkspace(
  mutate?: (canvas: Record<string, any>, native: boolean) => void,
) {
  let stored: Record<string, any>;
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST' || options?.method === 'PATCH') {
      const input = JSON.parse(options.body as string);
      stored = { id: 'native-1', ...stored, ...input };
      return response(stored, options.method === 'POST' ? 201 : 200);
    }
    const canvas = JSON.parse(stored.content);
    if (url.endsWith('/data')) {
      if (stored.type === 'slide') canvas.settings.theme = 'ambiguous';
      if (stored.type === 'sheet')
        canvas.sheets[0].columns.push({ id: 'D', name: 'D', type: 'text' });
      mutate?.(canvas, true);
      return response({ id: stored.id, title: stored.title, data: canvas });
    }
    mutate?.(canvas, false);
    return response({ ...stored, content: JSON.stringify(canvas) });
  });
}

describe('Ambiguous AI native presentations and spreadsheets', () => {
  it('guards title-only edits before a write', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({
          id: 'doc-1',
          type: 'doc',
          title: 'Human title',
          content: 'same body',
        }),
      );
    await expect(
      new AmbiguousProvider('test', fetcher).save({
        id: 'doc-1',
        title: 'New title',
        content: 'Draft',
        lastContent: 'same body',
        lastTitle: 'Old title',
      }),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves an unrelated human title during explicit delta application', async () => {
    const fetcher = nativeWorkspace();
    const provider = new AmbiguousProvider('test', fetcher as typeof fetch);
    const first = await provider.save({
      title: 'Pilot budget',
      content: 'Fallback',
      format: 'spreadsheet',
      spreadsheet,
    });
    const source = projectWorkspaceDocument(first, {
      title: 'Pilot budget',
      content: 'Fallback',
      format: 'spreadsheet',
      spreadsheet,
      kind: 'plan',
      status: 'draft',
    });
    await fetcher('https://app.ambiguous.ai/api/documents/native-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Human title' }),
    });
    const current = await provider.get(first.id);
    const changed = structuredClone(source.spreadsheet!);
    changed.sheets[0].rows[1].B = 18;
    const saved = await provider.save({
      id: first.id,
      title: source.title,
      content: 'Revised overview',
      format: 'spreadsheet',
      spreadsheet: changed,
      sourceProjection: source,
      lastContent: current.content!,
      lastTitle: current.title,
    });
    expect(saved.title).toBe('Human title');
    expect(JSON.parse(saved.content!).sheets[0].rows[1].B).toBe(18);
  });

  it('creates imported native-coordinate sheets without adding another header or shifting formulas', async () => {
    const fetcher = nativeWorkspace();
    const native = { ...spreadsheet, nativeCoordinates: true };
    const saved = await new AmbiguousProvider(
      'test',
      fetcher as typeof fetch,
    ).save({
      title: 'Native budget',
      content: 'Fallback',
      format: 'spreadsheet',
      spreadsheet: native,
    });
    const sheet = JSON.parse(saved.content!).sheets[0];
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0].C).toBe('=B1*2');
  });
  it('creates an editable native slide canvas with all copy and speaker notes', async () => {
    const fetcher = nativeWorkspace();
    const onWritten = vi.fn();
    const saved = await new AmbiguousProvider(
      'test',
      fetcher as typeof fetch,
    ).save({
      title: 'Bakery pilot',
      content: 'Readable fallback',
      format: 'presentation',
      presentation,
      onWritten,
    });
    expect(saved.type).toBe('slide');
    const posted = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(posted.type).toBe('slide');
    const canvas = JSON.parse(posted.content);
    expect(canvas.settings.aspectRatio).toBe('16:9');
    expect(canvas.slides).toHaveLength(1);
    expect(canvas.slides[0].notes).toBe(presentation.slides[0].notes);
    for (const value of [
      presentation.slides[0].title,
      ...presentation.slides[0].bullets,
    ])
      expect(
        canvas.slides[0].elements.some(
          (element: { type: string; text: string }) =>
            element.type === 'text' && element.text.includes(value),
        ),
      ).toBe(true);
    expect(onWritten).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'native-1', content: posted.content }),
    );
    expect(fetcher.mock.calls[2][0]).toContain('/slides/native-1/data');
  });

  it('maps arbitrary keys to A1-compatible column IDs and preserves numeric values and formulas', async () => {
    const fetcher = nativeWorkspace();
    const saved = await new AmbiguousProvider(
      'test',
      fetcher as typeof fetch,
    ).save({
      title: 'Pilot budget',
      content: 'Readable fallback',
      format: 'spreadsheet',
      spreadsheet,
    });
    const sheet = JSON.parse(saved.content!).sheets[0];
    expect(
      sheet.columns.map((column: { id: string; name: string }) => [
        column.id,
        column.name,
      ]),
    ).toEqual([
      ['A', 'Item'],
      ['B', 'Unit cost'],
      ['C', 'Total'],
    ]);
    expect(sheet.rows).toEqual([
      { A: 'Item', B: 'Unit cost', C: 'Total' },
      { A: 'Pastry', B: 12, C: '=B2*2' },
      { A: 'Flour', B: 4, C: '=SUM(B2:B3)' },
    ]);
    expect(sheet.cells).toContainEqual(
      expect.objectContaining({
        row: 0,
        col: 0,
        value: 'Item',
        format: expect.objectContaining({ bold: true }),
      }),
    );
    expect(sheet.cells).toContainEqual(
      expect.objectContaining({ row: 1, col: 2, formula: '=B2*2' }),
    );
    expect(sheet.cells).toContainEqual(
      expect.objectContaining({
        row: 1,
        col: 1,
        value: 12,
        format: expect.objectContaining({ numberFormat: '#,##0.00' }),
      }),
    );
    expect(fetcher.mock.calls[2][0]).toContain('/sheets/native-1/data');
  });

  it('updates the same native ID using canonical content from the previous save', async () => {
    const fetcher = nativeWorkspace();
    const provider = new AmbiguousProvider('test', fetcher as typeof fetch);
    const first = await provider.save({
      title: 'Pilot budget',
      content: 'Fallback',
      format: 'spreadsheet',
      spreadsheet,
    });
    const updated = structuredClone(spreadsheet);
    updated.sheets[0].rows[0].unit_cost = 15;
    const saved = await provider.save({
      id: first.id,
      title: 'Updated budget',
      content: 'New fallback',
      format: 'spreadsheet',
      spreadsheet: updated,
      lastContent: first.content!,
    });
    expect(saved.id).toBe(first.id);
    const patch = fetcher.mock.calls.find(
      ([, options]) => options?.method === 'PATCH',
    );
    expect(patch?.[0]).toContain('/documents/native-1');
    expect(JSON.parse(patch![1]!.body as string)).not.toHaveProperty('type');
    expect(JSON.parse(saved.content!).sheets[0].rows[1].B).toBe(15);
  });

  it('retries a native create with the retained identity when the response omitted content and read-back failed', async () => {
    const native = nativeWorkspace();
    let readFailed = false;
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      const result = await native(url, options);
      if (options?.method === 'POST') return response({ id: 'native-1' }, 201);
      if (options?.method === 'GET' && !readFailed) {
        readFailed = true;
        return response({}, 503);
      }
      return result;
    });
    let id: string | undefined;
    let lastContent: string | undefined;
    const provider = new AmbiguousProvider('test', fetcher as typeof fetch);
    const input = {
      title: 'Budget',
      content: 'Fallback',
      format: 'spreadsheet' as const,
      spreadsheet,
      onCreated: (createdId: string) => {
        id = createdId;
      },
      onWritten: (written: { content: string | null }) => {
        lastContent = written.content ?? undefined;
      },
    };
    await expect(provider.save(input)).rejects.toThrow('503');
    expect(id).toBe('native-1');
    expect(lastContent).toContain('=B2*2');
    await expect(
      provider.save({ ...input, id, lastContent }),
    ).resolves.toMatchObject({ id: 'native-1', type: 'sheet' });
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === 'PATCH'),
    ).toHaveLength(1);
  });

  it('preserves external native edits and rejects a format conversion before writing', async () => {
    const fetcher = vi.fn().mockImplementation(async () =>
      response({
        id: 'native-1',
        type: 'slide',
        content: 'changed by collaborator',
      }),
    );
    const provider = new AmbiguousProvider('test', fetcher);
    await expect(
      provider.save({
        id: 'native-1',
        title: 'Budget',
        content: 'Fallback',
        format: 'spreadsheet',
        spreadsheet,
        lastContent: 'earlier canonical canvas',
      }),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
    await expect(
      provider.save({
        id: 'native-1',
        title: 'Budget',
        content: 'Fallback',
        format: 'spreadsheet',
        spreadsheet,
        lastContent: 'changed by collaborator',
      }),
    ).rejects.toThrow('different format');
    expect(
      fetcher.mock.calls.every(([, options]) => options.method === 'GET'),
    ).toBe(true);
  });

  it.each([false, true])(
    'rejects lost formulas in %s native read-back while retaining the written identity',
    async (native) => {
      const fetcher = nativeWorkspace((canvas, isNative) => {
        if (native === isNative) canvas.sheets[0].rows[1].C = 24;
      });
      const onCreated = vi.fn();
      const onWritten = vi.fn();
      await expect(
        new AmbiguousProvider('test', fetcher as typeof fetch).save({
          title: 'Budget',
          content: 'Fallback',
          format: 'spreadsheet',
          spreadsheet,
          onCreated,
          onWritten,
        }),
      ).rejects.toThrow(
        native ? 'editor content' : 'preserve all native content',
      );
      expect(onCreated).toHaveBeenCalledWith('native-1');
      expect(onWritten).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'native-1',
          content: expect.any(String),
        }),
      );
    },
  );

  it('does not mark a differently titled or typed resource as verified', async () => {
    const native = nativeWorkspace();
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      const result = await native(url, options);
      if (options?.method === 'GET' && !url.endsWith('/data')) {
        const body = await result.json();
        return response({ ...body, title: 'Wrong title', type: 'doc' });
      }
      return result;
    });
    await expect(
      new AmbiguousProvider('test', fetcher as typeof fetch).save({
        title: 'Pilot',
        content: 'Fallback',
        format: 'presentation',
        presentation,
      }),
    ).rejects.toThrow('title or format');
  });

  it('does not silently publish Markdown when structured native content is missing', async () => {
    const fetcher = vi.fn();
    await expect(
      new AmbiguousProvider('test', fetcher).save({
        title: 'Pilot',
        content: '# Fallback',
        format: 'presentation',
      }),
    ).rejects.toThrow('structured slides');
    await expect(
      new AmbiguousProvider('test', fetcher).save({
        title: 'Budget',
        content: '# Fallback',
        format: 'spreadsheet',
      }),
    ).rejects.toThrow('structured sheets');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('workspace comments and read errors', () => {
  it('retains authors, parent relationships, resolved state, and timestamps from complete threads', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({
          data: [
            {
              id: 'c1',
              content: 'Review this',
              created_at: '2026-09-12T00:00:00Z',
              author: { id: 'u1', display_name: 'Alex' },
              resolved: false,
              replies: [
                {
                  id: 'c2',
                  content: 'Reviewed',
                  created_at: '2026-09-12T00:01:00Z',
                  resolved_at: '2026-09-12T00:02:00Z',
                  author: { id: 'u2', display_name: 'Blair' },
                },
              ],
            },
          ],
          total: 1,
          has_more: false,
        }),
      );
    const comments = await new AmbiguousProvider('test', fetcher).listComments(
      'doc-1',
    );
    expect(comments).toEqual([
      expect.objectContaining({
        id: 'c1',
        authorId: 'u1',
        authorName: 'Alex',
        resolved: false,
        createdAt: '2026-09-12T00:00:00Z',
      }),
      expect.objectContaining({
        id: 'c2',
        parentId: 'c1',
        authorName: 'Blair',
        resolved: true,
      }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('posts only the requested comment and optional reply target', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response(
          {
            id: 'c2',
            content: 'Please check this figure.',
            parent_id: 'c1',
            resolved: false,
            created_at: '2026-09-12T00:00:00Z',
            author: null,
          },
          201,
        ),
      );
    await new AmbiguousProvider('test', fetcher).createComment(
      'doc-1',
      'Please check this figure.',
      'c1',
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      content: 'Please check this figure.',
      parent_id: 'c1',
    });
    expect(fetcher.mock.calls[0][1].method).toBe('POST');
  });
  it('surfaces incomplete comment lists and HTTP status for deleted or inaccessible resources', async () => {
    const incomplete = vi
      .fn()
      .mockResolvedValue(response({ data: [], has_more: true }));
    await expect(
      new AmbiguousProvider('test', incomplete).listComments('doc-1'),
    ).rejects.toThrow('complete comment list');
    const missing = vi.fn().mockResolvedValue(response({}, 404));
    await expect(
      new AmbiguousProvider('test', missing).get('doc-1'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
