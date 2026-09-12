import type {
  ArtifactContent,
  DocumentFormat,
  PresentationContent,
  SpreadsheetCell,
  SpreadsheetContent,
} from '../../shared/types';
import { shiftFormulaForHeader } from '../../shared/spreadsheet';
import type { WorkspaceDocument } from './ambiguous';

type ObjectValue = Record<string, unknown>;
type Path = (string | number)[];
type Projection = ArtifactContent & {
  previewLimited: boolean;
  previewNotice?: string;
};

export class WorkspaceMergeError extends Error {
  constructor(
    message = 'This change would restructure native content that Sidekick cannot safely map. The workspace copy is preserved; review the proposed draft in Sidekick, then edit the native file in Ambiguous AI.',
  ) {
    super(message);
    this.name = 'WorkspaceMergeError';
  }
}

const record = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const objects = (value: unknown): ObjectValue[] =>
  Array.isArray(value) ? value.map(record) : [];
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const at = (root: unknown, path: Path): ObjectValue =>
  path.reduce<unknown>(
    (value, key) => (value as Record<string | number, unknown>)?.[key],
    root,
  ) as ObjectValue;

function parsed(content: string | null): ObjectValue {
  if (content === null)
    throw new WorkspaceMergeError('The native workspace body is empty.');
  const result = JSON.parse(content) as unknown;
  if (result === null || typeof result !== 'object' || Array.isArray(result))
    throw new WorkspaceMergeError('The workspace body is not a native object.');
  return result as ObjectValue;
}

function formatOf(
  document: WorkspaceDocument,
  previous: ArtifactContent,
): DocumentFormat {
  return document.type === 'slide'
    ? 'presentation'
    : document.type === 'sheet'
      ? 'spreadsheet'
      : document.type === 'doc'
        ? 'document'
        : (previous.format ?? 'document');
}

export function nativeColumnId(index: number): string {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

type TextSegment = {
  path: Path;
  start: number;
  end: number;
  offsets: (number | null)[];
};
type RenderedText = { text: string; segments: TextSegment[] };

/** A display projection only. The original ProseMirror tree remains authoritative. */
function renderRichText(root: ObjectValue, markdown: boolean): RenderedText {
  let text = '';
  const segments: TextSegment[] = [];
  const emit = (value: string) => {
    text += value;
  };
  const textLeaf = (node: ObjectValue, path: Path) => {
    const raw = String(node.text ?? '');
    const marks = objects(node.marks);
    const wrappers: [string, string][] = markdown
      ? marks.flatMap((mark): [string, string][] => {
          if (mark.type === 'bold' || mark.type === 'strong')
            return [['**', '**']];
          if (mark.type === 'italic' || mark.type === 'em') return [['*', '*']];
          if (mark.type === 'strike') return [['~~', '~~']];
          if (mark.type === 'code') return [['`', '`']];
          if (
            mark.type === 'link' &&
            typeof record(mark.attrs).href === 'string'
          )
            return [['[', `](${record(mark.attrs).href})`]];
          return [];
        })
      : [];
    wrappers.forEach(([prefix]) => emit(prefix));
    const start = text.length;
    const offsets: (number | null)[] = [0];
    for (let index = 0; index < raw.length; index++) {
      const character = raw[index];
      if (markdown && /[\\`*_[\]<>|]/.test(character)) {
        emit('\\');
        offsets.push(null);
      }
      emit(character);
      offsets.push(index + 1);
    }
    segments.push({ path, start, end: text.length, offsets });
    wrappers.toReversed().forEach(([, suffix]) => emit(suffix));
  };
  const walk = (node: ObjectValue, path: Path, listPrefix?: string) => {
    if (node.type === 'text') {
      textLeaf(node, path);
      return;
    }
    if (node.type === 'hardBreak') {
      emit(markdown ? '  \n' : '\n');
      return;
    }
    if (node.type === 'horizontalRule') {
      emit(markdown ? '---' : '—');
      return;
    }
    if (node.type === 'image') {
      const attrs = record(node.attrs);
      emit(
        markdown
          ? `![${String(attrs.alt ?? 'Image')}](${String(attrs.src ?? '')})`
          : '[Image]',
      );
      return;
    }
    const children = objects(node.content);
    const visit = (child: ObjectValue, index: number, prefix?: string) =>
      walk(child, [...path, 'content', index], prefix);
    if (
      node.type === 'bulletList' ||
      node.type === 'orderedList' ||
      node.type === 'taskList'
    ) {
      children.forEach((child, index) => {
        if (index) emit('\n');
        const prefix =
          node.type === 'orderedList'
            ? `${Number(record(node.attrs).start ?? 1) + index}. `
            : markdown
              ? '- '
              : '• ';
        visit(child, index, prefix);
      });
    } else if (node.type === 'listItem' || node.type === 'taskItem') {
      emit(
        node.type === 'taskItem' && markdown
          ? `- [${record(node.attrs).checked ? 'x' : ' '}] `
          : (listPrefix ?? ''),
      );
      children.forEach((child, index) => {
        if (index) emit('\n');
        visit(child, index);
      });
    } else if (node.type === 'table') {
      children.forEach((row, rowIndex) => {
        if (rowIndex) emit('\n');
        emit('| ');
        objects(row.content).forEach((cell, cellIndex) => {
          if (cellIndex) emit(' | ');
          walk(cell, [...path, 'content', rowIndex, 'content', cellIndex]);
        });
        emit(' |');
        if (markdown && rowIndex === 0)
          emit(
            `\n| ${objects(row.content)
              .map(() => '---')
              .join(' | ')} |`,
          );
      });
    } else if (node.type === 'blockquote') {
      if (markdown) emit('> ');
      children.forEach((child, index) => {
        if (index) emit(markdown ? '\n> ' : '\n');
        visit(child, index);
      });
    } else if (node.type === 'codeBlock') {
      if (markdown)
        emit(`\`\`\`${String(record(node.attrs).language ?? '')}\n`);
      children.forEach((child, index) => visit(child, index));
      if (markdown) emit('\n```');
    } else {
      if (node.type === 'heading' && markdown)
        emit(
          '#'.repeat(
            Math.min(6, Math.max(1, Number(record(node.attrs).level ?? 1))),
          ) + ' ',
        );
      children.forEach((child, index) => {
        if (
          index &&
          (node.type === 'doc' ||
            !['paragraph', 'heading', 'tableCell', 'tableHeader'].includes(
              String(node.type),
            ))
        )
          emit(markdown ? '\n\n' : '\n');
        visit(child, index);
      });
      if (
        !children.length &&
        node.type &&
        !['paragraph', 'heading', 'tableCell', 'tableHeader', 'doc'].includes(
          String(node.type),
        )
      )
        emit(`[Native ${String(node.type)}]`);
    }
  };
  walk(root, []);
  return { text, segments };
}

function replaceRichText(
  root: ObjectValue,
  next: string,
  markdown: boolean,
): ObjectValue {
  const rendered = renderRichText(root, markdown);
  if (rendered.text === next) return root;
  const before = rendered.text.split('\n');
  const after = next.split('\n');
  if (before.length !== after.length) throw new WorkspaceMergeError();
  const edits: { path: Path; from: number; to: number; value: string }[] = [];
  let lineStart = 0;
  for (let index = 0; index < before.length; index++) {
    const left = before[index],
      right = after[index];
    if (left !== right) {
      let start = 0,
        end = 0;
      while (
        start < left.length &&
        start < right.length &&
        left[start] === right[start]
      )
        start++;
      while (
        end < left.length - start &&
        end < right.length - start &&
        left[left.length - 1 - end] === right[right.length - 1 - end]
      )
        end++;
      const from = lineStart + start,
        to = lineStart + left.length - end;
      const segment = rendered.segments.find(
        (candidate) => candidate.start <= from && candidate.end >= to,
      );
      if (!segment)
        throw new WorkspaceMergeError(
          'This text change crosses native formatting or block boundaries. The workspace copy is preserved.',
        );
      const rawFrom = segment.offsets[from - segment.start],
        rawTo = segment.offsets[to - segment.start];
      if (
        rawFrom === null ||
        rawTo === null ||
        rawFrom === undefined ||
        rawTo === undefined
      )
        throw new WorkspaceMergeError();
      const replacement = right.slice(start, right.length - end);
      edits.push({
        path: segment.path,
        from: rawFrom,
        to: rawTo,
        value: markdown
          ? replacement.replace(/\\([\\`*_[\]<>|])/g, '$1')
          : replacement,
      });
    }
    lineStart += left.length + 1;
  }
  const copy = structuredClone(root);
  for (const edit of edits.toReversed()) {
    const node = at(copy, edit.path);
    const original = String(node.text ?? '');
    node.text =
      original.slice(0, edit.from) + edit.value + original.slice(edit.to);
  }
  if (renderRichText(copy, markdown).text !== next)
    throw new WorkspaceMergeError(
      'This change adds native structure or formatting that cannot be safely merged.',
    );
  return copy;
}

const scalar = (value: unknown): SpreadsheetCell =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))
    ? value
    : value === undefined
      ? null
      : '[Unsupported native cell]';

function tabs(canvas: ObjectValue): {
  key: 'sheets' | 'tabs';
  values: ObjectValue[];
} {
  const key = Array.isArray(canvas.sheets) ? 'sheets' : 'tabs';
  if (!Array.isArray(canvas[key]))
    throw new WorkspaceMergeError(
      'The native workbook has no readable sheet list.',
    );
  return { key, values: objects(canvas[key]) };
}

function nativeCell(
  tab: ObjectValue,
  rowIndex: number,
  columnIndex: number,
): unknown {
  const columns = objects(tab.columns);
  const id = String(columns[columnIndex]?.id ?? nativeColumnId(columnIndex));
  const row = objects(tab.rows)[rowIndex] ?? {};
  if (Object.hasOwn(row, id)) return row[id];
  const cell = objects(tab.cells).find(
    (item) => item.row === rowIndex && item.col === columnIndex,
  );
  return typeof cell?.formula === 'string'
    ? cell.formula
    : (cell?.value ?? null);
}

function sheetProjection(canvas: ObjectValue): SpreadsheetContent {
  return {
    nativeCoordinates: true,
    sheets: tabs(canvas).values.map((tab, sheetIndex) => {
      const columns = objects(tab.columns);
      const cells = objects(tab.cells);
      const rowCount = Math.max(
        objects(tab.rows).length,
        ...cells.map((cell) => Number(cell.row) + 1).filter(Number.isFinite),
        0,
      );
      // /data pads to 26 default empty columns. They remain in the raw snapshot,
      // but need not make a small, otherwise editable workbook exceed draft limits.
      let count = columns.length;
      while (count > 1) {
        const column = columns[count - 1];
        const ordinaryDefault =
          (!column.name || column.name === nativeColumnId(count - 1)) &&
          (!column.type || column.type === 'text') &&
          Object.keys(column).every((key) =>
            ['id', 'name', 'type'].includes(key),
          );
        const populated = Array.from({ length: rowCount }, (_, row) =>
          nativeCell(tab, row, count - 1),
        ).some(
          (value) => value !== null && value !== undefined && value !== '',
        );
        if (!ordinaryDefault || populated) break;
        count--;
      }
      return {
        name: String(tab.name ?? `Sheet ${sheetIndex + 1}`),
        columns: columns.slice(0, count).map((column, index) => ({
          key: nativeColumnId(index),
          label: nativeColumnId(index),
          type: [
            'text',
            'number',
            'currency',
            'date',
            'boolean',
            'formula',
          ].includes(String(column.type))
            ? (column.type as SpreadsheetContent['sheets'][number]['columns'][number]['type'])
            : 'text',
        })),
        rows: Array.from({ length: rowCount }, (_, row) =>
          Object.fromEntries(
            columns
              .slice(0, count)
              .map((_, column) => [
                nativeColumnId(column),
                scalar(nativeCell(tab, row, column)),
              ]),
          ),
        ),
      };
    }),
  };
}

type SlideMap = {
  titleElement: number;
  body: { element: number; line: number | null }[];
};
function elementText(element: ObjectValue): string {
  const rich = record(element.content);
  return rich.type
    ? renderRichText(rich, false).text
    : String(element.text ?? '');
}
function slideProjection(canvas: ObjectValue): {
  presentation: PresentationContent;
  maps: SlideMap[];
} {
  if (!Array.isArray(canvas.slides))
    throw new WorkspaceMergeError(
      'The native presentation has no readable slides.',
    );
  const maps: SlideMap[] = [];
  const slides = objects(canvas.slides).map((slide) => {
    const elements = objects(slide.elements);
    const textElements = elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element.type === 'text');
    const useful = textElements.filter(
      ({ element }) =>
        !['SIDEKICK'].includes(elementText(element).trim()) &&
        !/^\d+\s*\/\s*\d+$/.test(elementText(element).trim()),
    );
    const title =
      useful.find(({ element }) =>
        String(element.id ?? '').endsWith('-title'),
      ) ??
      useful.toSorted(
        (left, right) =>
          Number(left.element.y ?? 0) - Number(right.element.y ?? 0),
      )[0];
    if (!title)
      throw new WorkspaceMergeError(
        'A slide has no safely identifiable title text.',
      );
    const body: SlideMap['body'] = [];
    const bullets: string[] = [];
    for (const { element, index } of useful) {
      if (index === title.index) continue;
      const value = elementText(element);
      if (!value) continue;
      const isList =
        String(element.id ?? '').endsWith('-body') ||
        value.split('\n').every((line) => /^\s*[•*-]\s/.test(line));
      if (isList)
        value.split('\n').forEach((line, lineIndex) => {
          body.push({ element: index, line: lineIndex });
          bullets.push(line.replace(/^\s*[•*-]\s?/, ''));
        });
      else {
        body.push({ element: index, line: null });
        bullets.push(value);
      }
    }
    maps.push({ titleElement: title.index, body });
    return {
      title: elementText(title.element),
      bullets,
      notes: String(slide.notes ?? ''),
    };
  });
  return { presentation: { slides }, maps };
}

export function projectWorkspaceDocument(
  snapshot: WorkspaceDocument,
  previous: ArtifactContent,
): Projection {
  const format = formatOf(snapshot, previous);
  const base: ArtifactContent = {
    title: snapshot.title,
    kind: previous.kind,
    status: previous.status,
    format,
    content: '',
  };
  try {
    if (format === 'document') {
      let content = snapshot.content ?? '';
      if (content.trim().startsWith('{'))
        content = renderRichText(parsed(content), true).text;
      return {
        ...base,
        content,
        previewLimited: !content && Boolean(snapshot.content),
        ...(!content && snapshot.content
          ? {
              previewNotice:
                'This native document contains content that cannot be fully shown here. Open it in Ambiguous AI.',
            }
          : {}),
      };
    }
    const canvas = parsed(snapshot.content);
    if (format === 'spreadsheet') {
      const spreadsheet = sheetProjection(canvas);
      const limited =
        spreadsheet.sheets.length > 6 ||
        spreadsheet.sheets.some(
          (sheet) =>
            sheet.columns.length > 20 ||
            sheet.rows.length > 201 ||
            !sheet.columns.length ||
            sheet.rows.some((row) =>
              Object.values(row).includes('[Unsupported native cell]'),
            ),
        );
      return {
        ...base,
        content: `# ${snapshot.title}\n\n${spreadsheet.sheets.map((sheet) => `- ${sheet.name}`).join('\n')}`,
        spreadsheet,
        previewLimited: limited,
        ...(limited
          ? {
              previewNotice:
                'This workbook exceeds Sidekick’s editable preview or contains unsupported cells. The full native workbook is preserved.',
            }
          : {}),
      };
    }
    const { presentation } = slideProjection(canvas);
    const limited =
      presentation.slides.length > 16 ||
      presentation.slides.some(
        (slide) =>
          slide.title.length > 120 ||
          slide.bullets.length > 5 ||
          slide.bullets.some((bullet) => bullet.length > 240) ||
          (slide.notes?.length ?? 0) > 4000,
      );
    return {
      ...base,
      content: `# ${snapshot.title}\n\n${presentation.slides.map((slide) => `- ${slide.title}`).join('\n')}`,
      presentation,
      previewLimited: limited,
      ...(limited
        ? {
            previewNotice:
              'This presentation exceeds Sidekick’s editable text preview. Its full native content is preserved.',
          }
        : {}),
    };
  } catch {
    return {
      ...base,
      content:
        'This native content cannot be fully previewed here. Open the workspace copy to inspect it.',
      previewLimited: true,
      previewNotice:
        'The native format cannot be mapped safely. Its full content is preserved in Ambiguous AI.',
    };
  }
}

function changedValue<T>(
  current: T,
  source: T,
  proposed: T,
  overwrite: boolean,
): T {
  if (equal(source, proposed)) return current;
  if (!overwrite && !equal(current, source) && !equal(current, proposed))
    throw new WorkspaceMergeError(
      'Both the workspace and this draft changed the same field. Review the overlap before applying the draft.',
    );
  return proposed;
}

function nativeDraftSpreadsheet(value: SpreadsheetContent): SpreadsheetContent {
  if (value.nativeCoordinates) return value;
  return {
    nativeCoordinates: true,
    sheets: value.sheets.map((sheet) => ({
      name: sheet.name,
      columns: sheet.columns.map((column, index) => ({
        ...column,
        key: nativeColumnId(index),
        label: nativeColumnId(index),
      })),
      rows: [
        Object.fromEntries(
          sheet.columns.map((column, index) => [
            nativeColumnId(index),
            column.label,
          ]),
        ),
        ...sheet.rows.map((row) =>
          Object.fromEntries(
            sheet.columns.map((column, index) => {
              const value = row[column.key] ?? null;
              return [
                nativeColumnId(index),
                typeof value === 'string'
                  ? shiftFormulaForHeader(value)
                  : value,
              ];
            }),
          ),
        ),
      ],
    })),
  };
}

function assertNotReordered(source: unknown[], current: unknown[]) {
  if (equal(source, current)) return;
  const values = source.map((value) => JSON.stringify(value));
  const remote = current.map((value) => JSON.stringify(value));
  if (
    new Set(values).size === values.length &&
    equal(values.toSorted(), remote.toSorted())
  )
    throw new WorkspaceMergeError(
      'The workspace reordered rows, columns, or slides. Refresh and revise against the new order before applying this draft.',
    );
}

function mergeSheets(
  canvas: ObjectValue,
  sourceValue: SpreadsheetContent,
  nextValue: SpreadsheetContent,
  overwrite: boolean,
): ObjectValue {
  const source = nativeDraftSpreadsheet(sourceValue),
    next = nativeDraftSpreadsheet(nextValue),
    current = sheetProjection(canvas);
  if (
    source.sheets.length !== next.sheets.length ||
    source.sheets.length !== current.sheets.length
  )
    throw new WorkspaceMergeError();
  const result = structuredClone(canvas);
  const nativeTabs = tabs(result).values;
  source.sheets.forEach((before, sheetIndex) => {
    const after = next.sheets[sheetIndex],
      remote = current.sheets[sheetIndex],
      raw = nativeTabs[sheetIndex];
    if (
      before.name !== after.name ||
      before.name !== remote.name ||
      before.columns.length !== after.columns.length ||
      before.columns.length !== remote.columns.length ||
      before.rows.length !== after.rows.length ||
      before.rows.length !== remote.rows.length
    )
      throw new WorkspaceMergeError();
    if (
      !equal(
        before.columns.map((column) => column.key),
        after.columns.map((column) => column.key),
      )
    )
      throw new WorkspaceMergeError();
    assertNotReordered(
      before.rows.map((row) => row.A),
      remote.rows.map((row) => row.A),
    );
    if (before.rows.length && remote.rows.length)
      assertNotReordered(
        Object.values(before.rows[0]),
        Object.values(remote.rows[0]),
      );
    const nativeColumns = objects(raw.columns);
    const nativeRows = objects(raw.rows);
    const nativeCells = objects(raw.cells);
    before.columns.forEach((column, columnIndex) => {
      if (column.label !== after.columns[columnIndex].label)
        throw new WorkspaceMergeError(
          'Native column letters cannot be renamed. Edit the visible header row instead.',
        );
      const actualColumn = nativeColumns[columnIndex];
      const nextType = changedValue(
        remote.columns[columnIndex].type,
        column.type,
        after.columns[columnIndex].type,
        overwrite,
      );
      if (nextType !== remote.columns[columnIndex].type)
        actualColumn.type = nextType;
      before.rows.forEach((oldRow, rowIndex) => {
        const proposed = after.rows[rowIndex][column.key] ?? null;
        const original = oldRow[column.key] ?? null;
        if (equal(original, proposed)) return;
        const value = changedValue(
          remote.rows[rowIndex][column.key] ?? null,
          original,
          proposed,
          overwrite,
        );
        const id = String(actualColumn.id ?? nativeColumnId(columnIndex));
        while (nativeRows.length <= rowIndex) nativeRows.push({});
        nativeRows[rowIndex][id] = value;
        let cells = nativeCells.filter(
          (cell) => cell.row === rowIndex && cell.col === columnIndex,
        );
        if (!cells.length) {
          const cell = { row: rowIndex, col: columnIndex };
          nativeCells.push(cell);
          cells = [cell];
        }
        cells.forEach((cell) => {
          if (typeof value === 'string' && value.startsWith('=')) {
            cell.formula = value;
            delete cell.value;
          } else {
            cell.value = value;
            delete cell.formula;
          }
        });
      });
    });
    raw.rows = nativeRows;
    raw.cells = nativeCells;
  });
  return result;
}

function setElementText(element: ObjectValue, value: string) {
  if (elementText(element) === value) return;
  if (record(element.content).type)
    element.content = replaceRichText(record(element.content), value, false);
  element.text = value;
}

function mergeSlides(
  canvas: ObjectValue,
  source: PresentationContent,
  next: PresentationContent,
  overwrite: boolean,
): ObjectValue {
  const current = slideProjection(canvas);
  if (
    source.slides.length !== next.slides.length ||
    source.slides.length !== current.presentation.slides.length
  )
    throw new WorkspaceMergeError();
  assertNotReordered(
    source.slides.map((slide) => slide.title),
    current.presentation.slides.map((slide) => slide.title),
  );
  const result = structuredClone(canvas);
  const nativeSlides = objects(result.slides);
  source.slides.forEach((before, index) => {
    const after = next.slides[index],
      remote = current.presentation.slides[index],
      mapping = current.maps[index];
    if (
      before.bullets.length !== after.bullets.length ||
      before.bullets.length !== remote.bullets.length
    )
      throw new WorkspaceMergeError();
    const slide = nativeSlides[index],
      elements = objects(slide.elements);
    setElementText(
      elements[mapping.titleElement],
      changedValue(remote.title, before.title, after.title, overwrite),
    );
    const notes = changedValue(
      remote.notes ?? '',
      before.notes ?? '',
      after.notes ?? '',
      overwrite,
    );
    if (notes !== (remote.notes ?? '')) slide.notes = notes;
    const changedElements = new Map<number, string>();
    before.bullets.forEach((bullet, bulletIndex) => {
      if (bullet === after.bullets[bulletIndex]) return;
      const value = changedValue(
        remote.bullets[bulletIndex],
        bullet,
        after.bullets[bulletIndex],
        overwrite,
      );
      const slot = mapping.body[bulletIndex];
      const existing =
        changedElements.get(slot.element) ??
        elementText(elements[slot.element]);
      if (slot.line === null) changedElements.set(slot.element, value);
      else {
        const lines = existing.split('\n');
        const prefix = lines[slot.line].match(/^\s*[•*-]\s?/)?.[0] ?? '';
        lines[slot.line] = prefix + value;
        changedElements.set(slot.element, lines.join('\n'));
      }
    });
    changedElements.forEach((text, element) =>
      setElementText(elements[element], text),
    );
  });
  return result;
}

/** Merge the proposed delta onto the full current native snapshot, never a rebuilt projection. */
export function mergeWorkspaceContent(
  snapshot: WorkspaceDocument,
  source: ArtifactContent,
  proposed: ArtifactContent,
  overwriteConflicts = false,
): string {
  const format = formatOf(snapshot, source);
  if (
    (source.format ?? 'document') !== format ||
    (proposed.format ?? 'document') !== format
  )
    throw new WorkspaceMergeError(
      'An existing native artifact cannot change format.',
    );
  const currentProjection = projectWorkspaceDocument(snapshot, source);
  if (currentProjection.previewLimited)
    throw new WorkspaceMergeError(currentProjection.previewNotice);
  if (format === 'spreadsheet') {
    if (!source.spreadsheet || !proposed.spreadsheet)
      throw new WorkspaceMergeError();
    return JSON.stringify(
      mergeSheets(
        parsed(snapshot.content),
        source.spreadsheet,
        proposed.spreadsheet,
        overwriteConflicts,
      ),
    );
  }
  if (format === 'presentation') {
    if (!source.presentation || !proposed.presentation)
      throw new WorkspaceMergeError();
    return JSON.stringify(
      mergeSlides(
        parsed(snapshot.content),
        source.presentation,
        proposed.presentation,
        overwriteConflicts,
      ),
    );
  }
  if (source.content === proposed.content) return snapshot.content!;
  const before = source.content.replace(/\r\n/g, '\n').trim().split('\n');
  const next = proposed.content.replace(/\r\n/g, '\n').trim().split('\n');
  const remote = currentProjection.content.split('\n');
  if (before.length !== next.length || before.length !== remote.length)
    throw new WorkspaceMergeError();
  const merged = before
    .map((line, index) =>
      changedValue(remote[index], line, next[index], overwriteConflicts),
    )
    .join('\n');
  if (!snapshot.content!.trim().startsWith('{')) return merged;
  return JSON.stringify(
    replaceRichText(parsed(snapshot.content), merged, true),
  );
}
