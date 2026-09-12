import { describe, expect, it } from 'vitest';
import { shiftFormulaForHeader } from './spreadsheet';

describe('native spreadsheet header references', () => {
  it('moves relative, absolute, mixed, lowercase, and range references', () => {
    expect(shiftFormulaForHeader('=SUM(A1:$B$4)+$c5+D$6')).toBe(
      '=SUM(A2:$B$5)+$c6+D$7',
    );
  });
  it('moves references across generated tabs without changing sheet names', () => {
    expect(
      shiftFormulaForHeader("='Budget A1'!$B$1+Assumptions!C2+Q1!D3"),
    ).toBe("='Budget A1'!$B$2+Assumptions!C3+Q1!D4");
    expect(shiftFormulaForHeader("='Cafe''s A1 plan'!B1")).toBe(
      "='Cafe''s A1 plan'!B2",
    );
  });
  it('preserves strings, escaped quotes, and ordinary text cells', () => {
    expect(shiftFormulaForHeader('=IF(A1="A1","say ""B2""",B2)')).toBe(
      '=IF(A2="A1","say ""B2""",B3)',
    );
    expect(shiftFormulaForHeader('Room A1')).toBe('Room A1');
  });
  it('does not mistake a numbered function or identifier for a cell reference', () => {
    expect(shiftFormulaForHeader('=LOG10(A1)+named_A1+Sheet.A1')).toBe(
      '=LOG10(A2)+named_A1+Sheet.A1',
    );
  });
});
