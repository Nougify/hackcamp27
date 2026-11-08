import type { ExpiryExtractionResponse } from '@/contracts/api';

// SPEC F4: Gemini returns date components and this module turns them into a date. Pure.
//
// A date with no printed year resolves to its next occurrence on or after today: a package stamped
// with today's date is far more likely to mean today than a year from now.

export interface DateComponents {
  raw_text?: string | null;
  date_type: ExpiryExtractionResponse['dateType'];
  year?: number | null;
  month?: number | null;
  day?: number | null;
  year_was_printed: boolean;
  ambiguous_order: boolean;
  confidence: ExpiryExtractionResponse['confidence'];
}

const MONTH_CODES: Record<string, number> = { JA: 1, FE: 2, MR: 3, AL: 4, MA: 5, JN: 6, JL: 7, AU: 8, SE: 9, OC: 10, NO: 11, DE: 12 };

// SPEC's pattern, bounded so "MA 2026" can't read as May 20 and "NORTH 12" can't read as November.
const CFIA = /(?<!\d)(\d{2,4})?\s*(?<![A-Z])(JA|FE|MR|AL|MA|JN|JL|AU|SE|OC|NO|DE)(?![A-Z])\s*(\d{1,2})(?!\d)/gi;
// "BB/MA" is the bilingual "best before / meilleur avant" marker, not the month of May.
const BEST_BEFORE_MARKER = /\b(?:B\.?B\.?\s*\/\s*M\.?A\.?|M\.?A\.?\s*\/\s*B\.?B\.?)(?![A-Z])/gi;

export interface CfiaMatch {
  year: number | null;
  month: number;
  day: number;
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

export function parseCfia(rawText: string): CfiaMatch[] {
  const out: CfiaMatch[] = [];
  for (const m of rawText.replace(BEST_BEFORE_MARKER, ' ').matchAll(CFIA)) {
    const day = Number(m[3]);
    if (day < 1 || day > 31) continue;
    out.push({ year: m[1] ? fullYear(Number(m[1])) : null, month: MONTH_CODES[m[2].toUpperCase()], day });
  }
  return out;
}

export function regexCrossCheck(x: DateComponents): ExpiryExtractionResponse['regexCrossCheck'] {
  const matches = x.raw_text ? parseCfia(x.raw_text) : [];
  if (matches.length === 0) return 'no_match';
  const year = x.year_was_printed && x.year != null ? fullYear(x.year) : null;
  const agrees = matches.some((m) => {
    const sameOrder = m.month === x.month && m.day === x.day;
    const swapped = x.ambiguous_order && m.month === x.day && m.day === x.month;
    return (sameOrder || swapped) && (m.year === null || year === null || m.year === year);
  });
  return agrees ? 'agree' : 'disagree';
}

/** Same cap as expiryRawText in the pantry schema, so a long read can't block saving. */
const RAW_TEXT_MAX = 200;

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD, or null if that calendar day doesn't exist. */
function toIso(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function nextOccurrence(month: number, day: number, today: string): string | null {
  const start = Number(today.slice(0, 4));
  for (let year = start; year <= start + 8; year++) {
    const iso = toIso(year, month, day);
    if (iso && iso >= today) return iso;
  }
  return null;
}

function shiftYears(iso: string, years: number): string {
  return `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;
}

export function assembleDate(x: DateComponents, today: string): ExpiryExtractionResponse {
  const base = {
    rawText: x.raw_text?.trim().slice(0, RAW_TEXT_MAX) || null,
    dateType: x.date_type,
    regexCrossCheck: regexCrossCheck(x),
    confidence: x.confidence,
  };
  const none: ExpiryExtractionResponse = { ...base, suggestedDate: null, candidates: [], needsUserChoice: false, yearInferred: false };
  if (x.date_type === 'packaged_on' || x.month == null || x.day == null) return none;

  const printedYear = x.year_was_printed && x.year != null ? fullYear(x.year) : null;
  const orders: Array<[number, number]> = [[x.month, x.day]];
  if (x.ambiguous_order && x.month !== x.day) orders.push([x.day, x.month]);

  const earliest = shiftYears(today, -1);
  const latest = shiftYears(today, 5);
  const candidates = [
    ...new Set(
      orders
        .filter(([month]) => month >= 1 && month <= 12)
        .map(([month, day]) => (printedYear === null ? nextOccurrence(month, day, today) : toIso(printedYear, month, day)))
        .filter((iso): iso is string => iso !== null && iso >= earliest && iso <= latest),
    ),
  ];
  if (candidates.length === 0) return none;

  return {
    ...base,
    suggestedDate: candidates[0],
    candidates,
    needsUserChoice: candidates.length > 1,
    yearInferred: printedYear === null,
  };
}
