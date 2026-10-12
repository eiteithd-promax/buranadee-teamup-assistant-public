/** Browser-local, calendar-credential-scoped terminology and reviewed work translations. */
export type ApprovedTranslation = { source: string; translation: string; updatedAt: string };
export type TermPair = { thai: string; english: string };
export type TranslationStore = {
  entries: ApprovedTranslation[];
  terms: TermPair[];
};

const MAX_ENTRIES = 400;
const MAX_TERMS = 350;
const STORAGE_PREFIX = 'teamup-public-translation-memory-v1-';
const normalize = (text: string) => text.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('th-TH');

export const BUILTIN_ARCHITECTURE_TERMS: TermPair[] = [
  { thai: 'ไปหน้างาน', english: 'Site Visit' },
  { thai: 'ตรวจหน้างาน', english: 'Site Inspection' },
  { thai: 'ตรวจงาน', english: 'Work Inspection' },
  { thai: 'งานโครงสร้าง', english: 'Structural Work' },
  { thai: 'ประกอบงานโครงสร้าง', english: 'Structural Assembly Work' },
  { thai: 'โครงสร้างเหล็ก', english: 'Steel Structure' },
  { thai: 'ติดตั้งโครงสร้างเหล็ก', english: 'Structural Steel Erection' },
  { thai: 'งานวัดไทร', english: 'Wat Sai Project' },
  { thai: 'คานทับหลัง', english: 'Lintel Beam' },
  { thai: 'เสาเอ็น', english: 'Tie Column' },
  { thai: 'เสาเข็ม', english: 'Pile Foundation' },
  { thai: 'ฐานราก', english: 'Foundation' },
  { thai: 'พื้นคอนกรีตเสริมเหล็ก', english: 'Reinforced Concrete Slab' },
  { thai: 'เหล็กเสริม', english: 'Reinforcing Steel' },
  { thai: 'แบบหล่อ', english: 'Formwork' },
  { thai: 'งานระบบ', english: 'MEP Works' },
  { thai: 'ระบบไฟฟ้า', english: 'Electrical System' },
  { thai: 'ระบบสุขาภิบาล', english: 'Plumbing and Sanitary System' },
  { thai: 'ระบบแอร์', english: 'Air-Conditioning System' },
  { thai: 'ห้องซักรีด', english: 'Laundry Room' },
  { thai: 'ห้องน้ำป้อมยาม', english: 'Security Guard Bathroom' },
  { thai: 'เคลียร์แบบ', english: 'Drawing Coordination' },
  { thai: 'แก้แบบ', english: 'Revise Drawings' },
  { thai: 'ทำแบบ', english: 'Prepare Drawings' },
  { thai: 'เขียนแบบ', english: 'Draft Drawings' },
  { thai: 'ตรวจแบบ', english: 'Review Drawings' },
  { thai: 'ประชุมผู้รับเหมา', english: 'Contractor Meeting' },
  { thai: 'ประชุมหน้างาน', english: 'Site Coordination Meeting' },
  { thai: 'สำรวจหน้างาน', english: 'Site Survey' },
  { thai: 'ประสานงานผู้รับเหมา', english: 'Coordinate with Contractor' },
  { thai: 'ตรวจรับงาน', english: 'Work Acceptance Inspection' },
  { thai: 'งานหลังคา', english: 'Roofing Works' },
  { thai: 'งานสถาปัตยกรรม', english: 'Architectural Works' },
  { thai: 'งานตกแต่งภายใน', english: 'Interior Fit-Out Work' },
  { thai: 'รายการคำนวณโครงสร้าง', english: 'Structural Calculation Report' },
  { thai: 'ถอดปริมาณ', english: 'Quantity Takeoff' },
  { thai: 'ราคากลาง', english: 'Cost Estimate' },
  { thai: 'ตรวจสอบรอยร้าว', english: 'Crack Inspection' },
];

export async function translationMemoryKey(connection: { apiKey: string; calendarKey: string } | null) {
  if (!connection || !connection.apiKey || !connection.calendarKey) return STORAGE_PREFIX + 'demo';
  if (!globalThis.crypto?.subtle) throw new Error('Secure local translation storage is unavailable on this device.');
  const input = new TextEncoder().encode(connection.calendarKey + '|' + connection.apiKey);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
  const prefix = Array.from(hash.slice(0, 16)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return STORAGE_PREFIX + prefix;
}
export function emptyTranslationStore(): TranslationStore { return { entries: [], terms: [] }; }
function approved(entry: unknown): entry is ApprovedTranslation {
  const candidate = entry as Partial<ApprovedTranslation> | null;
  return Boolean(candidate && typeof candidate.source === 'string' && candidate.source.trim().length <= 500 &&
    candidate.source.trim().length > 0 && typeof candidate.translation === 'string' &&
    candidate.translation.trim().length > 0 && candidate.translation.trim().length <= 500);
}
function term(entry: unknown): entry is TermPair {
  const candidate = entry as Partial<TermPair> | null;
  return Boolean(candidate && typeof candidate.thai === 'string' && candidate.thai.trim().length > 0 &&
    candidate.thai.trim().length <= 100 && typeof candidate.english === 'string' &&
    candidate.english.trim().length > 0 && candidate.english.trim().length <= 160);
}
export function parseTranslationStore(raw: string | null): TranslationStore {
  if (!raw) return emptyTranslationStore();
  try {
    const parsed = JSON.parse(raw) as Partial<TranslationStore> | null;
    return {
      entries: Array.isArray(parsed?.entries) ? parsed.entries.filter(approved).slice(-MAX_ENTRIES) : [],
      terms: Array.isArray(parsed?.terms) ? parsed.terms.filter(term).slice(-MAX_TERMS) : [],
    };
  } catch { return emptyTranslationStore(); }
}
export function loadTranslationStore(key: string): TranslationStore {
  return parseTranslationStore(window.localStorage.getItem(key));
}
export function persistTranslationStore(key: string, store: TranslationStore) {
  window.localStorage.setItem(key, JSON.stringify({
    entries: store.entries.slice(-MAX_ENTRIES),
    terms: store.terms.slice(-MAX_TERMS),
  }));
}
export function findApprovedTranslation(store: TranslationStore, source: string): string | null {
  const normalized = normalize(source);
  return store.entries.find(entry => normalize(entry.source) === normalized)?.translation || null;
}
export function approveTranslation(store: TranslationStore, source: string, translation: string): TranslationStore {
  const a = source.trim().slice(0, 500);
  const b = translation.trim().slice(0, 500);
  if (!a || !b) return store;
  return {
    ...store,
    entries: [...store.entries.filter(item => normalize(item.source) !== normalize(a)),
      { source: a, translation: b, updatedAt: new Date().toISOString() }].slice(-MAX_ENTRIES),
  };
}
export function deleteTranslation(store: TranslationStore, source: string): TranslationStore {
  return { ...store, entries: store.entries.filter(item => normalize(item.source) !== normalize(source)) };
}
export function addTerm(store: TranslationStore, thai: string, english: string): TranslationStore {
  const a = thai.trim().slice(0, 100);
  const b = english.trim().slice(0, 160);
  if (!a || !b) return store;
  return {
    ...store,
    terms: [...store.terms.filter(item => normalize(item.thai) !== normalize(a)), { thai: a, english: b }].slice(-MAX_TERMS),
  };
}
export function deleteTerm(store: TranslationStore, thai: string): TranslationStore {
  return { ...store, terms: store.terms.filter(item => normalize(item.thai) !== normalize(thai)) };
}
function overlapScore(a: string, b: string): number {
  const s = normalize(a);
  const t = normalize(b);
  if (s === t) return 1;
  const fragments = new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  if (!fragments.size) return 0;
  let matched = 0;
  fragments.forEach(fragment => { if (t.includes(fragment)) matched++; });
  return matched / fragments.size;
}
export function translationHints(store: TranslationStore, source: string) {
  const relevantTerms = [...store.terms, ...BUILTIN_ARCHITECTURE_TERMS]
    .filter(term => normalize(source).includes(normalize(term.thai)))
    .filter((item, i, all) => all.findIndex(other => normalize(other.thai) === normalize(item.thai)) === i)
    .sort((a, b) => b.thai.length - a.thai.length)
    .slice(0, 16);
  const examples = store.entries.map(entry => ({
    ...entry,
    score: overlapScore(source, entry.source),
  })).filter(item => item.score > 0.32).sort((a, b) => b.score - a.score).slice(0, 3)
    .map(item => ({ source: item.source, translation: item.translation }));
  return { terms: relevantTerms, examples };
}
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else { cell += char; }
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  if (quoted) throw new Error('Unterminated quoted CSV cell.');
  return rows;
}
export function importTranslationData(store: TranslationStore, text: string, filename: string) {
  if (text.length > 1_000_000) throw new Error('Translation file is too large (maximum 1 MB).');
  let next = store;
  let count = 0;
  if (filename.toLowerCase().endsWith('.csv')) {
    const rows = parseCsvRows(text);
    const head = (rows[0] || []).map(value => value.trim().toLowerCase());
    const asMemory = head.includes('source') && head.includes('translation');
    const left = asMemory ? head.indexOf('source') : Math.max(0, head.indexOf('thai'));
    const right = asMemory ? head.indexOf('translation') : head.includes('english') ? head.indexOf('english') : 1;
    for (const row of rows.slice(head.some(item => ['source', 'thai'].includes(item)) ? 1 : 0)) {
      if (!row[left]?.trim() || !row[right]?.trim()) continue;
      next = asMemory ? approveTranslation(next, row[left], row[right]) : addTerm(next, row[left], row[right]);
      count++;
    }
  } else {
    const parsed = JSON.parse(text) as unknown;
    const object = parsed as Partial<TranslationStore> | null;
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(object?.entries) ? object.entries : [];
    const terms = Array.isArray(object?.terms) ? object.terms : [];
    for (const entry of entries) {
      if (approved(entry)) { next = approveTranslation(next, entry.source, entry.translation); count++; }
      else if (term(entry)) { next = addTerm(next, entry.thai, entry.english); count++; }
    }
    for (const entry of terms) {
      if (term(entry)) { next = addTerm(next, entry.thai, entry.english); count++; }
    }
  }
  return { store: next, count };
}
export function exportTranslationData(store: TranslationStore) {
  return JSON.stringify({ format: 'teamup-translation-memory-v1', entries: store.entries, terms: store.terms }, null, 2);
}
