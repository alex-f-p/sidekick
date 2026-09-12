import { z } from "zod";
const item = z.object({ text: z.string().min(1).max(3000) });

export const presentationSchema = z.object({
  slides: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        bullets: z.array(z.string().min(1).max(240)).max(5),
        notes: z.string().max(4000).optional(),
      }),
    )
    .min(1)
    .max(16),
});

// Spreadsheet formulas may only calculate from this workbook. No external data
// functions, external workbook links, or executable spreadsheet commands.
const formulaFunctions = new Set([
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTA",
  "COUNTIF",
  "SUMIF",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "ABS",
  "IF",
  "IFERROR",
  "AND",
  "OR",
  "NOT",
]);
export function safeSpreadsheetFormula(value: string): boolean {
  if (!value.startsWith("=")) return true;
  // Quoted strings are literal labels, not function calls. Sheet names use
  // single quotes; external paths and brackets are disallowed even in names.
  const expression = value.replace(/"(?:[^"]|"")*"/g, '""');
  if (
    /[\[\]{}|\\;\r\n]/.test(expression) ||
    /(?:https?:|file:|ftp:)/i.test(expression)
  )
    return false;
  const withoutSheetNames = expression.replace(/'(?:[^']|'')+'!/g, "");
  const functions = [
    ...withoutSheetNames.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g),
  ];
  if (functions.some((match) => !formulaFunctions.has(match[1].toUpperCase())))
    return false;
  // After stripping supported functions, cell references, and constants, only
  // ordinary formula punctuation may remain. Bare names never resolve tools.
  const rest = withoutSheetNames
    .replace(/([A-Za-z_][A-Za-z0-9_]*)!/g, "")
    .replace(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g, "(")
    .replace(/\$?[A-Za-z]{1,3}\$?\d+/g, "0")
    .replace(/\b(?:TRUE|FALSE)\b/gi, "0");
  return /^[\d\s=+\-*/^%(),.:<>"&]*$/.test(rest);
}

const sheetValue = z
  .union([z.string().max(3000), z.number().finite(), z.boolean(), z.null()])
  .refine(
    (value) => typeof value !== "string" || safeSpreadsheetFormula(value),
    "Use a formula with local cell references and supported functions.",
  );
export const spreadsheetSchema = z
  .object({
    nativeCoordinates: z.boolean().optional(),
    sheets: z
      .array(
        z
          .object({
            name: z
              .string()
              .min(1)
              .max(31)
              .regex(/^[^\[\]:*?/\\]+$/),
            columns: z
              .array(
                z.object({
                  key: z
                    .string()
                    .min(1)
                    .max(40)
                    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
                  label: z.string().min(1).max(100),
                  type: z.enum([
                    "text",
                    "number",
                    "currency",
                    "date",
                    "boolean",
                    "formula",
                  ]),
                }),
              )
              .min(1)
              .max(20),
            rows: z.array(z.record(z.string(), sheetValue)).min(1).max(201),
          })
          .superRefine((sheet, context) => {
            const keys = sheet.columns.map((column) => column.key);
            if (new Set(keys).size !== keys.length)
              context.addIssue({
                code: "custom",
                message: "Column keys must be unique.",
                path: ["columns"],
              });
            sheet.rows.forEach((row, index) => {
              if (Object.keys(row).some((key) => !keys.includes(key)))
                context.addIssue({
                  code: "custom",
                  message: "Row keys must match the columns.",
                  path: ["rows", index],
                });
            });
          }),
      )
      .min(1)
      .max(6),
  })
  .superRefine((workbook, context) => {
    if (!workbook.nativeCoordinates && workbook.sheets.some(sheet => sheet.rows.length > 200))
      context.addIssue({code:'custom',message:'New sheets support up to 200 data rows.',path:['sheets']});
    if (
      new Set(workbook.sheets.map((sheet) => sheet.name.toLowerCase())).size !==
      workbook.sheets.length
    )
      context.addIssue({
        code: "custom",
        message: "Sheet names must be unique.",
        path: ["sheets"],
      });
    if (JSON.stringify(workbook).length > 120000)
      context.addIssue({
        code: "custom",
        message:
          "Keep the spreadsheet focused on the meeting; its content is too large.",
      });
  });

export const workDraftSchema = z
  .object({
    key: z.string().min(1).max(100),
    title: z.string().min(1).max(200),
    kind: z.enum(["research", "comparison", "proposal", "plan", "notes"]),
    content: z.string().min(1).max(60000),
    status: z.enum(["draft", "complete"]),
    format: z.enum(["document", "presentation", "spreadsheet"]).optional(),
    presentation: presentationSchema.optional(),
    spreadsheet: spreadsheetSchema.optional(),
  })
  .superRefine((draft, context) => {
    const format = draft.format ?? "document";
    if ((format === "presentation") !== Boolean(draft.presentation))
      context.addIssue({
        code: "custom",
        message:
          "A presentation needs slide content and only presentations may include it.",
        path: ["presentation"],
      });
    if ((format === "spreadsheet") !== Boolean(draft.spreadsheet))
      context.addIssue({
        code: "custom",
        message:
          "A spreadsheet needs sheet content and only spreadsheets may include it.",
        path: ["spreadsheet"],
      });
  });
export const analysisSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().max(12000),
  decisions: z.array(item.extend({ evidence: z.string().min(1) })).max(50),
  pending: z.array(item).max(50),
  ambiguities: z.array(item).max(50),
  followUps: z
    .array(
      item.extend({
        status: z.enum(["proposed", "agreed"]),
        owner: z.string().nullable(),
        evidence: z.string(),
      }),
    )
    .max(50),
  documents: z.array(workDraftSchema).max(12),
  researchQueries: z.array(z.string().min(1).max(600)).max(6),
  spokenResponse: z.string().max(4000),
});
export type Analysis = z.infer<typeof analysisSchema>;
export function parseAnalysis(text: string): Analysis {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return analysisSchema.parse(JSON.parse(clean));
}
