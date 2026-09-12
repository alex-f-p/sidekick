import { useId, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, FileText, Presentation, Table2 } from 'lucide-react';
import type { DocumentFormat, SpreadsheetCell, SpreadsheetContent, WorkDocument } from '../../shared/types';
import { shiftFormulaForHeader } from '../../shared/spreadsheet';

export const artifactFormats = [
  { id: 'document', label: 'Document', plural: 'Documents', icon: FileText },
  { id: 'presentation', label: 'Presentation', plural: 'Presentations', icon: Presentation },
  { id: 'spreadsheet', label: 'Spreadsheet', plural: 'Spreadsheets', icon: Table2 },
] as const;

export function artifactFormat(document: WorkDocument): DocumentFormat {
  return document.format === 'presentation' || document.format === 'spreadsheet'
    ? document.format : 'document';
}

export function artifactLabel(document: WorkDocument) {
  return artifactFormats.find(format => format.id === artifactFormat(document))!.label;
}

export function ArtifactIcon({ document, size = 21 }: { document: WorkDocument; size?: number }) {
  const Icon = artifactFormats.find(format => format.id === artifactFormat(document))!.icon;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}

export function artifactSize(document: WorkDocument) {
  if (artifactFormat(document) === 'presentation') {
    const count = document.presentation?.slides.length ?? 0;
    return `${count} ${count === 1 ? 'slide' : 'slides'}`;
  }
  if (artifactFormat(document) === 'spreadsheet') {
    const count = document.spreadsheet?.sheets.length ?? 0;
    return `${count} ${count === 1 ? 'sheet' : 'sheets'}`;
  }
  return '';
}

/** Native slide text and sheet cells should be discoverable alongside narrative. */
export function artifactSearchText(document: WorkDocument) {
  const slides = document.presentation?.slides.flatMap(slide => [slide.title, ...slide.bullets, slide.notes ?? '']) ?? [];
  const sheets = document.spreadsheet?.sheets.flatMap(sheet => [
    sheet.name, ...sheet.columns.map(column => column.label),
    ...sheet.rows.flatMap(row => Object.values(row).map(value => value == null ? '' : String(value))),
  ]) ?? [];
  return [document.title, document.content, document.kind, artifactLabel(document), ...slides, ...sheets].join(' ').toLowerCase();
}

export function ArtifactPreview({ document }: { document: WorkDocument }) {
  const format = artifactFormat(document);
  if (format === 'presentation') return <PresentationPreview key={document.id} document={document} />;
  if (format === 'spreadsheet') return <SpreadsheetPreview key={document.id} document={document} />;
  return null;
}

function EmptyPreview({ document, message }: { document: WorkDocument; message: string }) {
  return (
    <div className="artifact-empty">
      <ArtifactIcon document={document} size={28} />
      <h3>{message}</h3>
      <p>The summary and context are still available below.</p>
    </div>
  );
}

function PresentationPreview({ document }: { document: WorkDocument }) {
  const [selectedSlide, setSelectedSlide] = useState(0);
  const instructionsId = useId();
  const slides = document.presentation?.slides ?? [];
  const index = Math.min(selectedSlide, Math.max(0, slides.length - 1));
  const slide = slides[index];
  if (!slide) return <EmptyPreview document={document} message="No slides to preview yet." />;

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setSelectedSlide(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1
      : Math.max(0, Math.min(slides.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))));
  }

  return (
    <section className="artifact-preview presentation-preview" aria-label="Presentation preview">
      <div className="artifact-preview-heading">
        <span><Presentation size={15} /> Slides</span>
        <span className="artifact-preview-caption">Content preview</span>
      </div>
      <div
        className="slide-canvas"
        tabIndex={0}
        onKeyDown={navigate}
        role="group"
        aria-label={`Slide ${index + 1} of ${slides.length}: ${slide.title}`}
        aria-describedby={instructionsId}
      >
        <div className="slide-canvas-eyebrow"><span /> {document.kind}</div>
        <h3>{slide.title}</h3>
        {slide.bullets.length > 0 ? (
          <ul>{slide.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}</ul>
        ) : <p className="slide-cover-caption">{document.title !== slide.title ? document.title : ' '}</p>}
        <div className="slide-canvas-footer"><span>sidekick.</span><span>{String(index + 1).padStart(2, '0')}</span></div>
      </div>
      <div className="slide-controls">
        <p id={instructionsId}>Select the slide, then use the left and right arrow keys to browse.</p>
        <div>
          <button className="icon-button artifact-nav-button" disabled={index === 0} onClick={() => setSelectedSlide(index - 1)} aria-label="Previous slide"><ChevronLeft size={17} /></button>
          <span role="status" aria-live="polite">{index + 1} / {slides.length}</span>
          <button className="icon-button artifact-nav-button" disabled={index === slides.length - 1} onClick={() => setSelectedSlide(index + 1)} aria-label="Next slide"><ChevronRight size={17} /></button>
        </div>
      </div>
      {slides.length > 1 && (
        <nav className="slide-filmstrip" aria-label="Choose a slide">
          {slides.map((item, slideIndex) => (
            <button
              key={slideIndex}
              className={slideIndex === index ? 'active' : ''}
              aria-current={slideIndex === index ? 'step' : undefined}
              aria-label={`Show slide ${slideIndex + 1}: ${item.title}`}
              onClick={() => setSelectedSlide(slideIndex)}
            ><span>{String(slideIndex + 1).padStart(2, '0')}</span><strong>{item.title}</strong></button>
          ))}
        </nav>
      )}
      {slide.notes?.trim() && (
        <div className="slide-notes"><h4>Speaker notes</h4><p>{slide.notes}</p></div>
      )}
    </section>
  );
}

type SheetColumn = SpreadsheetContent['sheets'][number]['columns'][number];
const columnLabels: Record<SheetColumn['type'], string> = {
  text: 'Text', number: 'Number', currency: 'Currency', date: 'Date', boolean: 'Boolean', formula: 'Formula',
};
const rowsPerPage = 100;

function isFormula(value: SpreadsheetCell | undefined, column: SheetColumn) {
  return value != null && (column.type === 'formula' || typeof value === 'string' && value.startsWith('='));
}

function SheetCell({ value, column, nativeCoordinates }: { value: SpreadsheetCell | undefined; column: SheetColumn; nativeCoordinates: boolean }) {
  if (value == null) return <span className="sheet-empty-cell" aria-label="Empty cell">—</span>;
  // Never evaluate expressions or invent a cached result. Currency has no unit
  // in this payload, so preserve the supplied value without guessing a symbol.
  const formula = nativeCoordinates ? typeof value === 'string' && value.startsWith('=') : isFormula(value, column);
  if (formula) return <code className="sheet-formula" title="Formula using workspace row numbers; results are calculated in the workspace">{typeof value === 'string' && !nativeCoordinates ? shiftFormulaForHeader(value) : String(value)}</code>;
  if (typeof value === 'boolean') return <span className={`sheet-boolean ${value ? 'true' : 'false'}`}>{value ? 'True' : 'False'}</span>;
  return <span>{String(value)}</span>;
}

function SpreadsheetPreview({ document }: { document: WorkDocument }) {
  const [selectedSheet, setSelectedSheet] = useState(0);
  const [selectedPage, setSelectedPage] = useState(0);
  const previewId = useId();
  const sheets = document.spreadsheet?.sheets ?? [];
  const nativeCoordinates = document.spreadsheet?.nativeCoordinates === true;
  const index = Math.min(selectedSheet, Math.max(0, sheets.length - 1));
  const sheet = sheets[index];
  if (!sheet) return <EmptyPreview document={document} message="No sheets to preview yet." />;
  const page = Math.min(selectedPage, Math.max(0, Math.ceil(sheet.rows.length / rowsPerPage) - 1));
  const rowStart = page * rowsPerPage;
  const visibleRows = sheet.rows.slice(rowStart, rowStart + rowsPerPage);
  const hasFormulas = sheet.columns.some(column => column.type === 'formula')
    || sheet.rows.some(row => sheet.columns.some(column => isFormula(row[column.key], column)));

  function selectSheet(next: number) { setSelectedSheet(next); setSelectedPage(0); }
  function handleSheetKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const activeIndex = tabs.indexOf(event.target as HTMLButtonElement);
    if (activeIndex < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (activeIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus(); selectSheet(next);
  }

  return (
    <section className="artifact-preview spreadsheet-preview" aria-label="Spreadsheet preview">
      <div className="artifact-preview-heading">
        <span><Table2 size={15} /> Sheets</span>
        <span className="artifact-preview-caption">{sheet.rows.length} {sheet.rows.length === 1 ? 'row' : 'rows'} · {sheet.columns.length} {sheet.columns.length === 1 ? 'column' : 'columns'}</span>
      </div>
      <div className="sheet-tabs" role="tablist" aria-label="Spreadsheet sheets" onKeyDown={handleSheetKeys}>
        {sheets.map((item, sheetIndex) => (
          <button
            key={sheetIndex}
            role="tab"
            id={`${previewId}-tab-${sheetIndex}`}
            aria-controls={`${previewId}-panel-${sheetIndex}`}
            aria-selected={index === sheetIndex}
            tabIndex={index === sheetIndex ? 0 : -1}
            className={index === sheetIndex ? 'active' : ''}
            onClick={() => selectSheet(sheetIndex)}
          ><Table2 size={13} /><span>{item.name}</span></button>
        ))}
      </div>
      <div role="tabpanel" id={`${previewId}-panel-${index}`} aria-labelledby={`${previewId}-tab-${index}`}>
        {sheet.columns.length ? (
          <div className="sheet-scroll" tabIndex={0} role="region" aria-label={`${sheet.name} data. Scroll to see all columns.`}>
            <table className="sheet-table">
              <caption className="artifact-sr-only">{sheet.name}. {nativeCoordinates ? 'Row numbers match Ambiguous.' : 'Column types appear below each heading.'}</caption>
              <thead><tr><th scope="col" className="sheet-row-number"><span className="artifact-sr-only">{nativeCoordinates ? 'Row number' : 'Row 1: column headings'}</span><span aria-hidden="true">{nativeCoordinates ? '#' : '1'}</span></th>{sheet.columns.map(column => (
                <th key={column.key} scope="col"><span>{column.label}</span>{!nativeCoordinates && <small>{columnLabels[column.type]}</small>}</th>
              ))}</tr></thead>
              <tbody>{visibleRows.length ? visibleRows.map((row, rowIndex) => (
                <tr key={rowStart + rowIndex}>
                  <th scope="row" className="sheet-row-number">{rowStart + rowIndex + (nativeCoordinates ? 1 : 2)}</th>
                  {sheet.columns.map(column => <td key={column.key} className={`sheet-cell-${column.type}`}><SheetCell value={row[column.key]} column={column} nativeCoordinates={nativeCoordinates} /></td>)}
                </tr>
              )) : <tr><td colSpan={sheet.columns.length + 1} className="sheet-no-rows">The columns are ready. No rows have been added yet.</td></tr>}</tbody>
            </table>
          </div>
        ) : <div className="artifact-empty sheet-empty"><p>No columns have been added to this sheet yet.</p></div>}
        <div className="sheet-preview-footer">
          <p>{hasFormulas ? 'Formulas match the workspace layout. Results are calculated in the workspace.' : `Values are shown as supplied.${document.url ? ' Open the workspace to edit this sheet.' : ''}`}</p>
          {sheet.rows.length > rowsPerPage && (
            <div className="sheet-pagination">
              <button className="icon-button artifact-nav-button" aria-label="Previous rows" disabled={page === 0} onClick={() => setSelectedPage(page - 1)}><ChevronLeft size={16} /></button>
              <span role="status">{rowStart + 1}–{rowStart + visibleRows.length} of {sheet.rows.length}</span>
              <button className="icon-button artifact-nav-button" aria-label="Next rows" disabled={rowStart + rowsPerPage >= sheet.rows.length} onClick={() => setSelectedPage(page + 1)}><ChevronRight size={16} /></button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
