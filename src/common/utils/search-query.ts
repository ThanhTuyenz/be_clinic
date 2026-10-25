/** Shared, deterministic parsing for search. Never treats a substring as a symptom. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9\s.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function containsSearchPhrase(target: string, phrase: string): boolean {
  const clean = (value: string) => normalizeSearch(value).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return Boolean(clean(phrase)) && ` ${clean(target)} `.includes(` ${clean(phrase)} `);
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
  hasConstraints: boolean;
}

export function parseSearchIntent(query: string): SearchIntent {
  let text = normalizeSearch(query.replace(/(^|\s)(?:tìm|cần|có|gói|bị|vì)(?=\s|$)/giu, '$1'));
  const intent: SearchIntent = { text: '', excluded: [], hasConstraints: false };
  if (/\bbac si\b/.test(text)) intent.entity = 'doctor';
  else if (/\b(co so|chi nhanh|phong kham)\b/.test(text)) intent.entity = 'branch';

  text = text.replace(/\b(khong bi|khong co|khong(?! qua\b)|chang bi)\s+(.+?)(?=\s+nhung\b|\s+ma\b|\s+chi\b|[,.;]|$)/g,
    (_match, _prefix, excluded: string) => {
      const phrase = excluded.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
      if (phrase) intent.excluded.push(phrase);
      return ' ';
    });
  text = text.replace(new RegExp(`\\btu\\s+${AMOUNT}\\s*(?:den|toi)\\s*${AMOUNT}`, 'g'),
    (_m, low, lowUnit, high, highUnit) => {
      intent.minPrice = money(low, lowUnit || highUnit || '');
      intent.maxPrice = money(high, highUnit || lowUnit || '');
      return ' ';
    });
  text = text.replace(new RegExp(`\\b(duoi|khong qua|toi da|tren|tu|it nhat)\\s+${AMOUNT}`, 'g'),
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
  text = text.replace(/\b(\d{1,3})\s*tuoi\b/g, (_m, age) => { intent.age = Number(age); return ' '; });
  text = text.replace(/\b(?:cho|danh cho|toi la|minh la)\s+(nam|nu)\b/g, (_m, gender) => {
    intent.gender = gender === 'nam' ? 'MALE' : 'FEMALE'; return ' ';
  });
  intent.text = text.replace(/\b(co so|chi nhanh|phong kham)\b/g, ' ').replace(FILLER, ' ')
    .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  intent.text = intent.text.replace(/^bi\s+/, '');
  if (intent.excluded.length) intent.text = intent.text.replace(/^(ma|chi)\s+/, '');
  intent.hasConstraints = intent.minPrice !== undefined || intent.maxPrice !== undefined ||
    intent.age !== undefined || intent.gender !== undefined;
  return intent;
}

export function searchTextScore(query: string, target: string): number {
  if (!query.trim() || !target.trim()) return 0;
  const q = normalizeSearch(query).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const t = normalizeSearch(target).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q === t) return 5;
  if (containsSearchPhrase(t, q)) return 4;
  if (t.split(' ').length >= 2 && containsSearchPhrase(q, t)) return 3.5;
  const tokens = [...new Set(q.split(' ').filter(Boolean))];
  const targetTokens = new Set(t.split(' '));
  // All meaningful query words must match; one generic "đau" cannot match "đau đầu".
  return tokens.length > 1 && tokens.every(token => targetTokens.has(token)) ? 2.5 : 0;
}

export function matchesSearchConstraints(intent: SearchIntent, item: {
  price: number; targetGender?: string; minAge?: number | null; maxAge?: number | null;
}): boolean {
  if (intent.minPrice !== undefined && (intent.minExclusive ? item.price <= intent.minPrice : item.price < intent.minPrice)) return false;
  if (intent.maxPrice !== undefined && (intent.maxExclusive ? item.price >= intent.maxPrice : item.price > intent.maxPrice)) return false;
  if (intent.gender && item.targetGender && item.targetGender !== 'ALL' && item.targetGender !== intent.gender) return false;
  if (intent.age !== undefined && ((item.minAge != null && intent.age < item.minAge) || (item.maxAge != null && intent.age > item.maxAge))) return false;
  return true;
}
