/** Shared, deterministic parsing for search. Never treats a substring as a symptom. */
const foldSearch = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const cleanSearchText = (text: string) => text.normalize('NFC').toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function normalizeSearch(text: string): string {
  return foldSearch(text).replace(/[^a-z0-9\s.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Match parser operators without accents while preserving the original search words. */
export function replaceSearchText(text: string, pattern: string | RegExp, replacement: (...match: any[]) => string): string {
  text = text.normalize('NFC');
  let cursor = 0;
  let output = '';
  foldSearch(text).replace(pattern, (...match) => {
    const offset = match[match.length - 2] as number;
    output += text.slice(cursor, offset) + replacement(...match);
    cursor = offset + match[0].length;
    return match[0];
  });
  return output + text.slice(cursor);
}

export function containsSearchPhrase(target: string, phrase: string): boolean {
  const query = cleanSearchText(normalizeSearch(phrase));
  return Boolean(query) && ` ${cleanSearchText(normalizeSearch(target))} `.includes(` ${query} `);
}

// Keep clinical words such as tim, tai, cơ, cận, dày and khoa after accent folding.
const FILLER = /\b(tim kiem|gan day|thuong xuyen|bac si|chuyen khoa|dich vu|phong kham|kiem tra|toi|minh|muon|giup|cho|xin|dang|hay|mot|nhung|va|la|duoc|khong|nhe|oi|kham)\b/g;
const money = (value: string, unit: string) => Number((unit && /^(tr|trieu|k|nghin|ngan)/.test(unit)
  ? value : value.replace(/\./g, '')).replace(',', '.')) *
  (/^(tr|trieu)/.test(unit) ? 1_000_000 : /^(k|nghin|ngan)/.test(unit) ? 1000 : 1);
const AMOUNT = '(\\d+(?:[.,]\\d+)*)\\s*(trieu|tr|nghin|ngan|k|vnd|dong|d)?\\b(?!\\s*tuoi\\b)';

export interface SearchIntent {
  text: string;
  excluded: string[];
  minPrice?: number;
  maxPrice?: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
  age?: number;
  gender?: 'MALE' | 'FEMALE';
  entity?: 'doctor' | 'branch';
  followUp?: boolean;
  hasConstraints: boolean;
}

export function parseSearchIntent(query: string): SearchIntent {
  let text = query.normalize('NFC').toLowerCase().replace(/(^|\s)(?:tìm|cần|có|gói|bị|vì|tại)(?=\s|$)/giu, '$1');
  const intent: SearchIntent = { text: '', excluded: [], hasConstraints: false };
  text = replaceSearchText(text, /\b(?:khong(?: phai| muon| can)?|bo qua|loai bo)\s+(?:goi\s+)?(?:tai kham|kham lai|followup|follow up)\b/g,
    () => { intent.followUp = false; return ' '; });

  text = replaceSearchText(text, /\b(khong bi|khong co|khong(?! qua\b)|chang bi)\s+(.+?)(?=\s+nhung\b|\s+ma\b|\s+chi\b|[,.;]|$)/g,
    (match, _prefix, excluded: string, offset: number) => {
      const original = text.slice(offset + match.length - excluded.length, offset + match.length);
      const phrase = cleanSearchText(replaceSearchText(original, FILLER, () => ' '));
      if (phrase) intent.excluded.push(phrase);
      return ' ';
    });
  text = replaceSearchText(text, /\b(tai kham|kham lai|followup|follow up)\b/g,
    () => { if (intent.followUp === undefined) intent.followUp = true; return ' '; });
  if (/\bbac si\b/.test(foldSearch(text))) intent.entity = 'doctor';
  else if (/\b(co so|chi nhanh|phong kham)\b/.test(foldSearch(text))) intent.entity = 'branch';
  text = replaceSearchText(text, new RegExp(`\\btu\\s+${AMOUNT}\\s*(?:den|toi)\\s*${AMOUNT}`, 'g'),
    (_m, low, lowUnit, high, highUnit) => {
      intent.minPrice = money(low, lowUnit || highUnit || '');
      intent.maxPrice = money(high, highUnit || lowUnit || '');
      return ' ';
    });
  text = replaceSearchText(text, new RegExp(`\\b(duoi|khong qua|toi da|tren|tu|it nhat)\\s+${AMOUNT}`, 'g'),
    (_m, operator, value, unit) => {
      if (['duoi', 'khong qua', 'toi da'].includes(operator)) {
        intent.maxPrice = money(value, unit || '');
        intent.maxExclusive = operator === 'duoi';
      } else {
        intent.minPrice = money(value, unit || '');
        intent.minExclusive = operator === 'tren';
      }
      return ' ';
    });
  text = replaceSearchText(text, /\b(\d{1,3})\s*tuoi\b/g, (_m, age) => { intent.age = Number(age); return ' '; });
  text = replaceSearchText(text, /\b(?:cho|danh cho|toi la|minh la)\s+(nam|nu)\b/g, (_m, gender) => {
    intent.gender = gender === 'nam' ? 'MALE' : 'FEMALE'; return ' ';
  });
  text = replaceSearchText(text, /\b(co so|chi nhanh|phong kham)\b/g, () => ' ');
  intent.text = cleanSearchText(replaceSearchText(text, FILLER, () => ' '));
  intent.text = replaceSearchText(intent.text, /^bi\s+/, () => '');
  if (intent.excluded.length) intent.text = replaceSearchText(intent.text, /^(ma|chi)\s+/, () => '');
  intent.hasConstraints = intent.minPrice !== undefined || intent.maxPrice !== undefined ||
    intent.age !== undefined || intent.gender !== undefined || intent.followUp !== undefined;
  return intent;
}

export function searchTextScore(query: string, target: string): number {
  if (!query.trim() || !target.trim()) return 0;
  const accented = foldSearch(query) !== query.toLowerCase().normalize('NFC');
  // The common Vietnamese name and the catalog term denote the same condition.
  // Canonicalize whole phrases on both sides; retain the original accent policy.
  const canonical = (value: string) => replaceSearchText(value, /\btieu duong\b/g, () => 'đái tháo đường');
  const q = cleanSearchText(accented ? canonical(query) : normalizeSearch(canonical(query)));
  const t = cleanSearchText(accented ? canonical(target) : normalizeSearch(canonical(target)));
  if (q === t) return 5;
  if (` ${t} `.includes(` ${q} `)) return 4;
  if (t.split(' ').length >= 2 && ` ${q} `.includes(` ${t} `)) return 3.5;
  const tokens = [...new Set(q.split(' ').filter(Boolean))];
  const targetTokens = new Set(t.split(' '));
  // All meaningful query words must match; one generic "đau" cannot match "đau đầu".
  return tokens.length > 1 && tokens.every(token => targetTokens.has(token)) ? 2.5 : 0;
}

/** Conservative typo fallback: one edit, one changed word, and a specific exact anchor. */
export function searchTypoScore(query: string, target: string): number {
  const q = normalizeSearch(query);
  // Accented clinical words retain strict matching (e.g. tai/tái and dày/dây).
  if (cleanSearchText(query) !== q || q.length > 60) return 0;
  const tokens = [...new Set(q.split(' ').filter(Boolean))];
  if (tokens.length < 2 || tokens.length > 5) return 0;
  const words = new Set(normalizeSearch(target).split(' '));
  const generic = new Set(['kham', 'khoa', 'goi', 'dich', 'vu', 'tong', 'quat', 'benh', 'dau']);
  if (!tokens.some(token => token.length >= 3 && !generic.has(token) && words.has(token))) return 0;
  const missing = tokens.filter(token => !words.has(token));
  if (missing.length !== 1 || missing[0].length < 3) return 0;
  const oneEdit = (a: string, b: string): boolean => {
    if (b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length >= b.length) i++;
      if (b.length >= a.length) j++;
    }
    return edits + (i < a.length || j < b.length ? 1 : 0) === 1;
  };
  return [...words].some(word => oneEdit(missing[0], word)) ? 1.25 : 0;
}

export function matchesSearchConstraints(intent: SearchIntent, item: {
  price: number; targetGender?: string; minAge?: number | null; maxAge?: number | null; isFollowUp?: boolean;
}): boolean {
  if (intent.followUp !== undefined && item.isFollowUp !== undefined && intent.followUp !== item.isFollowUp) return false;
  if (intent.minPrice !== undefined && (intent.minExclusive ? item.price <= intent.minPrice : item.price < intent.minPrice)) return false;
  if (intent.maxPrice !== undefined && (intent.maxExclusive ? item.price >= intent.maxPrice : item.price > intent.maxPrice)) return false;
  if (intent.gender && item.targetGender && item.targetGender !== 'ALL' && item.targetGender !== intent.gender) return false;
  if (intent.age !== undefined && ((item.minAge != null && intent.age < item.minAge) || (item.maxAge != null && intent.age > item.maxAge))) return false;
  return true;
}

export function matchesSearchExclusions(intent: SearchIntent, fields: Array<string | null | undefined>): boolean {
  return !intent.excluded.some(phrase => fields.some(field => field && searchTextScore(phrase, field) > 0));
}
