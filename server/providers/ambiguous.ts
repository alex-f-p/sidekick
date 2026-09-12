import type {
  ArtifactContent,
  DocumentFormat,
  PresentationContent,
  SpreadsheetContent,
  WorkspaceComment,
} from '../../shared/types';
import { shiftFormulaForHeader } from '../../shared/spreadsheet';
import {
  mergeWorkspaceContent,
  projectWorkspaceDocument,
  WorkspaceMergeError,
} from './ambiguous-content';

export type WorkspaceDocument = {
  id: string;
  title: string;
  type?: 'doc' | 'slide' | 'sheet';
  content: string | null;
  updated_at?: string;
  url?: string;
  import_warnings?: string[];
};

type SaveInput = {
  id?: string;
  title: string;
  content: string;
  format?: DocumentFormat;
  presentation?: PresentationContent;
  spreadsheet?: SpreadsheetContent;
  lastContent?: string;
  lastTitle?: string;
  sourceProjection?: ArtifactContent;
  overwriteConflicts?: boolean;
  onCreated?: (id: string) => void;
  onWritten?: (document: WorkspaceDocument) => void;
};

const colors = { cream: '#F5F4EC', forest: '#294C40', sage: '#718467' };

const estimatedLines = (value: string, charactersPerLine: number) =>
  value
    .split('\n')
    .reduce(
      (count, line) =>
        count + Math.max(1, Math.ceil(line.length / charactersPerLine)),
      0,
    );

function titleFontSize(value: string) {
  for (let size = 38; size >= 20; size--)
    if (
      estimatedLines(value, Math.floor(832 / (size * 0.58))) * size * 1.3 <=
      111
    )
      return size;
  return 20;
}

// A1 formulas and the range API use letter IDs, even when a column has a custom label.
function columnId(index: number): string {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function presentationCanvas(presentation?: PresentationContent) {
  if (!presentation?.slides.length)
    throw new Error(
      'A presentation needs structured slides before it can be saved.',
    );
  // Split long lists into continuation slides to keep editable text legible.
  const pages = presentation.slides.flatMap((slide) => {
    const groups: string[][] = [[]];
    let lines = 0;
    for (const bullet of slide.bullets) {
      const bulletLines = estimatedLines(bullet, 58);
      if (lines + bulletLines > 8 && groups.at(-1)!.length) {
        groups.push([]);
        lines = 0;
      }
      groups.at(-1)!.push(bullet);
      lines += bulletLines;
    }
    return groups.map((bullets, index) => ({
      ...slide,
      title: slide.title + (index ? ' (continued)' : ''),
      bullets,
    }));
  });
  return {
    settings: {
      aspectRatio: '16:9',
      defaultBackground: colors.cream,
      showSlideNumbers: false,
    },
    slides: pages.map((slide, index) => {
      const id = `sidekick-slide-${index + 1}`;
      const text = (
        suffix: string,
        value: string,
        x: number,
        y: number,
        w: number,
        h: number,
        fontSize: number,
        bold = false,
        color = colors.forest,
      ) => ({
        id: `${id}-${suffix}`,
        type: 'text',
        text: value,
        x,
        y,
        w,
        h,
        fontSize,
        fontFamily: 'Arial',
        fontWeight: bold ? 'bold' : 'normal',
        color,
        colorUserSet: true,
        lineHeight: 1.3,
        align: 'left',
        verticalAlign: 'top',
      });
      return {
        id,
        layout: { width: 960, height: 540 },
        background: colors.cream,
        notes: slide.notes ?? '',
        elements: [
          text(
            'title',
            slide.title,
            64,
            89,
            832,
            111,
            titleFontSize(slide.title),
            true,
          ),
          text('eyebrow', 'SIDEKICK', 64, 34, 832, 24, 12, true, colors.sage),
          text(
            'body',
            slide.bullets.map((bullet) => `• ${bullet}`).join('\n'),
            64,
            219,
            832,
            264,
            24,
          ),
          text(
            'number',
            `${index + 1} / ${pages.length}`,
            64,
            507,
            832,
            20,
            11,
            false,
            colors.sage,
          ),
        ],
      };
    }),
  };
}

function spreadsheetCanvas(spreadsheet?: SpreadsheetContent) {
  if (
    !spreadsheet?.sheets.length ||
    spreadsheet.sheets.some((sheet) => !sheet.columns.length)
  )
    throw new Error(
      'A spreadsheet needs structured sheets and columns before it can be saved.',
    );
  return {
    sheets: spreadsheet.sheets.map((sheet) => ({
      name: sheet.name,
      columns: sheet.columns.map((column, index) => ({
        id: columnId(index),
        name: column.label,
        type: column.type,
        width: column.type === 'text' ? 260 : 160,
      })),
      rows: [
        ...(!spreadsheet.nativeCoordinates
          ? [
              Object.fromEntries(
                sheet.columns.map((column, index) => [
                  columnId(index),
                  column.label,
                ]),
              ),
            ]
          : []),
        ...sheet.rows.map((row) =>
          Object.fromEntries(
            sheet.columns.map((column, index) => {
              const value = row[column.key] ?? null;
              return [
                columnId(index),
                typeof value === 'string' && !spreadsheet.nativeCoordinates
                  ? shiftFormulaForHeader(value)
                  : value,
              ];
            }),
          ),
        ),
      ],
      cells: [
        ...(!spreadsheet.nativeCoordinates
          ? sheet.columns.map((column, col) => ({
              row: 0,
              col,
              value: column.label,
              format: {
                fontFamily: 'Arial',
                fontSize: 11,
                bold: true,
                color: '#FFFFFF',
                backgroundColor: colors.forest,
                wrapStrategy: 'wrap',
              },
            }))
          : []),
        ...sheet.rows.flatMap((row, rowIndex) =>
          sheet.columns.map((column, colIndex) => {
            const raw = row[column.key] ?? null;
            const value =
              typeof raw === 'string' && !spreadsheet.nativeCoordinates
                ? shiftFormulaForHeader(raw)
                : raw;
            const formula = typeof value === 'string' && value.startsWith('=');
            return {
              row: rowIndex + (spreadsheet.nativeCoordinates ? 0 : 1),
              col: colIndex,
              ...(formula ? { formula: value } : { value }),
              format: {
                fontFamily: 'Arial',
                fontSize: 11,
                color: colors.forest,
                backgroundColor: rowIndex % 2 ? '#FFFFFF' : colors.cream,
                wrapStrategy: 'wrap',
                ...(column.type === 'currency'
                  ? { numberFormat: '#,##0.00' }
                  : {}),
                ...(column.type === 'number'
                  ? { numberFormat: '#,##0.##' }
                  : {}),
                ...(column.type === 'date'
                  ? { numberFormat: 'yyyy-mm-dd' }
                  : {}),
              },
            };
          }),
        ),
      ],
    })),
  };
}

// Read APIs enrich canvases with rich text, default settings, and spare sheet columns.
// Require every authored value while allowing those additive fields.
function preservesCanvas(
  actual: unknown,
  expected: unknown,
  key = '',
): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) return false;
    if (key !== 'columns' && actual.length !== expected.length) return false;
    return expected.every((item, index) =>
      preservesCanvas(actual[index], item),
    );
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([name, value]) =>
      preservesCanvas((actual as Record<string, unknown>)[name], value, name),
    );
  }
  return actual === expected;
}

function equalNativeProjection(
  document: WorkspaceDocument,
  data: unknown,
  previous: ArtifactContent,
): boolean {
  const expected = projectWorkspaceDocument(document, previous);
  const actual = projectWorkspaceDocument(
    { ...document, content: JSON.stringify(data) },
    previous,
  );
  return (
    !actual.previewLimited &&
    equal(expected.presentation, actual.presentation) &&
    equal(expected.spreadsheet, actual.spreadsheet) &&
    expected.content === actual.content
  );
}
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export class WorkspaceConflictError extends Error {
  constructor(
    message = 'This document was edited in Ambiguous AI. Your edits were preserved; review the new local draft before updating the workspace.',
  ) {
    super(message);
  }
}
export class AmbiguousProvider {
  constructor(
    private apiKey = process.env.AMBIGUOUS_API_KEY,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    path: string,
    body?: object,
    method?: string,
  ): Promise<unknown> {
    if (!this.apiKey)
      throw new Error(
        'Ambiguous AI is not configured. Add AMBIGUOUS_API_KEY to .env.local.',
      );
    const response = await this.fetcher(`https://app.ambiguous.ai/api${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'API-Version': '1',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Object.assign(
        new Error(
          `Ambiguous AI ${method === 'PATCH' ? 'update' : body ? 'save' : 'read'} failed (${response.status}). ${response.status === 401 ? 'Check the workspace API key.' : response.status === 403 ? 'The connected agent needs document access.' : 'The local copy is preserved.'}`,
        ),
        { status: response.status },
      );
    return response.json();
  }
  async identity() {
    return this.request('/users/me');
  }
  async workspace() {
    return this.request('/workspace');
  }
  async get(id: string): Promise<WorkspaceDocument> {
    const document = (await this.request(
      `/documents/${encodeURIComponent(id)}`,
    )) as WorkspaceDocument;
    if (document.id !== id || typeof document.content !== 'string')
      throw new Error('The saved workspace document could not be verified.');
    return {
      ...document,
      updated_at:
        typeof document.updated_at === 'string'
          ? document.updated_at
          : undefined,
    };
  }
  async listComments(id: string): Promise<WorkspaceComment[]> {
    const response = (await this.request(
      `/documents/${encodeURIComponent(id)}/comments`,
    )) as { data?: unknown; has_more?: boolean };
    if (!Array.isArray(response.data) || response.has_more === true)
      throw new Error('Ambiguous AI did not return a complete comment list.');
    const comments: WorkspaceComment[] = [];
    const seen = new Set<string>();
    const walk = (values: unknown[], parentId?: string) => {
      for (const raw of values) {
        const comment = this.comment(raw, parentId);
        if (!seen.has(comment.id)) {
          comments.push(comment);
          seen.add(comment.id);
        }
        const replies = (raw as { replies?: unknown[] }).replies;
        if (Array.isArray(replies)) walk(replies, comment.id);
      }
    };
    walk(response.data);
    return comments;
  }
  async createComment(
    id: string,
    content: string,
    parentId?: string,
  ): Promise<WorkspaceComment> {
    if (!content.trim()) throw new Error('A comment must contain text.');
    return this.comment(
      await this.request(`/documents/${encodeURIComponent(id)}/comments`, {
        content,
        ...(parentId ? { parent_id: parentId } : {}),
      }),
    );
  }
  private comment(value: unknown, parentId?: string): WorkspaceComment {
    if (!value || typeof value !== 'object')
      throw new Error('The workspace comment could not be verified.');
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== 'string' || typeof raw.content !== 'string')
      throw new Error('The workspace comment could not be verified.');
    const author =
      raw.author && typeof raw.author === 'object'
        ? (raw.author as Record<string, unknown>)
        : {};
    return {
      id: raw.id,
      content: raw.content,
      authorName:
        typeof author.display_name === 'string'
          ? author.display_name
          : undefined,
      authorId: typeof author.id === 'string' ? author.id : undefined,
      createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
      updatedAt:
        typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
      resolved: raw.resolved === true || typeof raw.resolved_at === 'string',
      parentId: typeof raw.parent_id === 'string' ? raw.parent_id : parentId,
    };
  }
  async save(input: SaveInput): Promise<WorkspaceDocument> {
    const format = input.format ?? 'document';
    const type =
      format === 'presentation'
        ? 'slide'
        : format === 'spreadsheet'
          ? 'sheet'
          : 'doc';
    let canvas: unknown =
      input.id && input.sourceProjection
        ? undefined
        : format === 'presentation'
          ? presentationCanvas(input.presentation)
          : format === 'spreadsheet'
            ? spreadsheetCanvas(input.spreadsheet)
            : undefined;
    let content = canvas ? JSON.stringify(canvas) : input.content;
    let title = input.title;
    let mergedDocumentCanvas: unknown;
    if (input.id) {
      const current = await this.get(input.id);
      if (
        input.lastContent === undefined ||
        current.content !== input.lastContent ||
        (input.lastTitle !== undefined && current.title !== input.lastTitle)
      )
        throw new WorkspaceConflictError();
      if ((canvas || current.type) && current.type !== type)
        throw new Error(
          'The workspace item has a different format. Its content was preserved.',
        );
      if (input.sourceProjection) {
        const source = input.sourceProjection;
        if (source.title === input.title) title = current.title;
        else if (
          !input.overwriteConflicts &&
          current.title !== source.title &&
          current.title !== input.title
        )
          throw new WorkspaceMergeError(
            'Both the workspace and this draft changed the title. Review the overlap before applying the draft.',
          );
        const proposed: ArtifactContent = {
          ...source,
          title: input.title,
          content: input.content,
          format,
          presentation: input.presentation,
          spreadsheet: input.spreadsheet,
        };
        content = mergeWorkspaceContent(
          current,
          source,
          proposed,
          input.overwriteConflicts,
        );
        if (format !== 'document') canvas = JSON.parse(content);
        else if (content.trim().startsWith('{'))
          mergedDocumentCanvas = JSON.parse(content);
      }
    }
    const document = (await this.request(
      input.id ? `/documents/${encodeURIComponent(input.id)}` : '/documents',
      input.id
        ? { title, content }
        : {
            type,
            title,
            content,
            visibility: 'workspace',
          },
      input.id ? 'PATCH' : 'POST',
    )) as WorkspaceDocument;
    if (typeof document.id !== 'string')
      throw new Error(
        'Ambiguous AI did not return a document ID. Save could not be verified.',
      );
    if (input.id && document.id !== input.id)
      throw new Error(
        'Ambiguous AI returned a different document ID. Update could not be verified.',
      );
    // Persist the identity immediately, even if the read-back fails; a retry must not create a duplicate.
    input.onCreated?.(document.id);
    // Native requests already carry canonical JSON. If a write response omits
    // its body, retain that exact candidate so a retry can compare it with the
    // remote copy. A transformed or externally edited copy still fails closed.
    input.onWritten?.(
      canvas && typeof document.content !== 'string'
        ? { ...document, content }
        : document,
    );
    const verified = await this.get(document.id);
    if (!verified.content)
      throw new Error('Ambiguous AI returned an empty saved document.');
    if (document.import_warnings?.length)
      throw new Error(
        'Ambiguous AI could not preserve all document content. Review the local draft and workspace copy.',
      );
    if (mergedDocumentCanvas) {
      let stored: unknown;
      try {
        stored = JSON.parse(verified.content);
      } catch {
        throw new Error('The native document content could not be verified.');
      }
      if (
        verified.title !== title ||
        !preservesCanvas(stored, mergedDocumentCanvas)
      )
        throw new Error(
          'Ambiguous AI did not preserve the merged native document. The local draft is preserved.',
        );
    }
    if (canvas) {
      if (verified.title !== title || verified.type !== type)
        throw new Error(
          'The saved workspace item title or format could not be verified.',
        );
      let storedCanvas: unknown;
      try {
        storedCanvas = JSON.parse(verified.content);
      } catch {
        throw new Error(
          'The saved workspace item did not contain a native canvas.',
        );
      }
      if (!preservesCanvas(storedCanvas, canvas))
        throw new Error(
          'Ambiguous AI did not preserve all native content. The local draft is preserved.',
        );
      const native = (await this.request(
        `/${type === 'slide' ? 'slides' : 'sheets'}/${encodeURIComponent(document.id)}/data`,
      )) as {
        id?: string;
        title?: string;
        data?: unknown;
      };
      if (
        native.id !== document.id ||
        native.title !== title ||
        !(input.sourceProjection
          ? equalNativeProjection(verified, native.data, input.sourceProjection)
          : preservesCanvas(native.data, canvas))
      )
        throw new Error(
          'The native workspace editor content could not be verified. The local draft is preserved.',
        );
    }
    return verified;
  }
}
