/**
 * Lossless monthly normalization for Teamup Calendar events.
 * One source occurrence can occupy several dates. The Teamup API includes
 * recurring occurrences as separate IDs and represents all-day end dates as
 * inclusive 23:59:59; midnight at the following day is an exclusive end.
 */
export type TeamupRawCalendarEvent = {
  id?: unknown;
  title?: unknown;
  start_dt?: unknown;
  end_dt?: unknown;
  all_day?: unknown;
  subcalendar_ids?: unknown;
  subcalendar_id?: unknown;
};
export type ExportCalendarEvent = {
  id: string;
  date: string;
  start: number;
  end: number;
  title: string;
  categories: string[];
  allDay: boolean;
  subcalendarIds: number[];
};
export type NormalizedMonthEvents = {
  events: ExportCalendarEvent[];
  sourceEventCount: number;
  exportSegmentCount: number;
};

function assertDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function nextDate(date: string) {
  return new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
}
function previousDate(date: string) {
  return new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}
type DayTime = { date: string; minutes: number; seconds: number };
function readTeamupDateTime(value: unknown, allDay: boolean, zone: string): DayTime | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/i);
  if (!match || !assertDate(match[1])) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  // All-day dates are calendar dates, not instants: never shift them across zones.
  if (!match[5] || allDay) return { date: match[1], minutes: hours * 60 + minutes, seconds };
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (key: string) => parts.find(part => part.type === key)?.value || '';
  const day = get('year') + '-' + get('month') + '-' + get('day');
  if (!assertDate(day)) return null;
  return { date: day, minutes: Number(get('hour')) * 60 + Number(get('minute')), seconds: Number(get('second')) };
}
function eventKey(event: ExportCalendarEvent) {
  return JSON.stringify([event.id, event.date, event.start, event.end,
    event.title, event.allDay, event.subcalendarIds]);
}

/**
 * Throws on malformed source data; never substitutes an empty result for an
 * incomplete Teamup API response. Clamps each occurrence to the queried month.
 */
export function normalizeTeamupMonthEvents(
  source: unknown,
  month: string,
  mapping: Record<string, number>,
  timeZone = 'Asia/Bangkok',
): NormalizedMonthEvents {
  if (!Array.isArray(source)) throw new Error('Teamup returned no valid events array.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month.');
  if (source.length > 20000) throw new Error('Too many events to verify in a single month.');
  const firstDay = month + '-01';
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString().slice(0, 10);
  const events = new Map<string, ExportCalendarEvent>();
  source.forEach((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') throw new Error('Malformed Teamup event ' + (index + 1));
    const raw = item as TeamupRawCalendarEvent;
    if (raw.id == null || String(raw.id).trim() === '') {
      throw new Error('Teamup event is missing its unique ID.');
    }
    const allDay = raw.all_day === true || raw.all_day === 1 ||
      raw.all_day === '1' || raw.all_day === 'true';
    const start = readTeamupDateTime(raw.start_dt, allDay, timeZone);
    const end = readTeamupDateTime(raw.end_dt, allDay, timeZone);
    if (!start || !end) throw new Error('Teamup event has an invalid start/end timestamp.');
    const startMinute = start.minutes;
    const endMinute = Math.min(1440, end.minutes + (end.seconds > 0 ? 1 : 0));
    if (end.date < start.date || (end.date === start.date && endMinute < startMinute)) {
      throw new Error('Teamup event ends before it starts.');
    }
    // 00:00 on a subsequent day is an exclusive bound; 23:59:59 is inclusive.
    const lastOccupied = end.date > start.date && endMinute === 0
      ? previousDate(end.date) : end.date;
    const first = start.date > firstDay ? start.date : firstDay;
    const last = lastOccupied < lastDay ? lastOccupied : lastDay;
    if (first > last) return; // Source occurrence is outside this month.
    const subcalendarIds = (Array.isArray(raw.subcalendar_ids)
      ? raw.subcalendar_ids : raw.subcalendar_id == null ? [] : [raw.subcalendar_id])
      .map(Number).filter((id: number) => Number.isFinite(id) && id > 0);
    const ids = Array.from(new Set<number>(subcalendarIds));
    const categories = Object.keys(mapping).filter(category => ids.includes(mapping[category]));
    const title = typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim() : 'Untitled event';
    let date = first;
    while (date <= last) {
      const dayStart = allDay ? 0 : date === start.date ? startMinute : 0;
      let dayEnd = allDay ? 1440 : date === end.date ? endMinute : 1440;
      if (date === start.date && date === end.date && dayEnd === dayStart) {
        dayEnd = Math.min(1440, dayStart + 1); // Zero-duration event is still visible.
      }
      if (dayEnd > dayStart) {
        const normalized: ExportCalendarEvent = {
          id: String(raw.id),
          date, start: dayStart, end: dayEnd, title,
          categories: categories.length ? categories : ['Job Routine'],
          allDay: allDay || (end.date > start.date && dayStart === 0 && dayEnd === 1440),
          subcalendarIds: ids,
        };
        events.set(eventKey(normalized), normalized);
      }
      date = nextDate(date);
    }
  });
  const result = Array.from(events.values()).sort((a, b) =>
    a.date.localeCompare(b.date) || a.start - b.start || a.id.localeCompare(b.id));
  return { events: result, sourceEventCount: source.length, exportSegmentCount: result.length };
}
