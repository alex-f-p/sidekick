/**
 * Structured drafts count their first data row as 1. Native workbooks include a
 * visible header row, so references in every generated tab move down one row.
 * Quoted strings and quoted sheet names are copied as complete tokens.
 */
export function shiftFormulaForHeader(value: string): string {
  if (!value.startsWith('=')) return value;
  const tokens =
    /"(?:[^"]|"")*"|'(?:[^']|'')*'|(?<![A-Za-z0-9_.$])(\$?[A-Za-z]{1,3})(\$?)([1-9]\d*)(?![A-Za-z0-9_!(])/g;
  return value.replace(
    tokens,
    (token, column: string | undefined, absoluteRow: string, row: string) =>
      column === undefined
        ? token
        : `${column}${absoluteRow}${BigInt(row) + 1n}`,
  );
}
