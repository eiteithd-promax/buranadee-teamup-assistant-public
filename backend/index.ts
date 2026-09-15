import { ai, error, json, router } from '@appdeploy/sdk';

type CategoryName =
  | 'Outside'
  | 'Follow Up'
  | 'Job Routine'
  | 'Meeting'
  | 'Leave';
type Connection = { apiKey: string; calendarKey: string };
type Mapping = Record<CategoryName, number>;
type IncomingEvent = {
  date?: unknown;
  start?: unknown;
  end?: unknown;
  title?: unknown;
  categories?: unknown;
};
type TeamupRawEvent = {
  id?: unknown;
  title?: unknown;
  start_dt?: unknown;
  end_dt?: unknown;
  all_day?: unknown;
  subcalendar_ids?: unknown;
};
const CATEGORIES: CategoryName[] = [
  'Outside',
  'Follow Up',
  'Job Routine',
  'Meeting',
  'Leave',
];
const TEAMUP_BASE = 'https://api.teamup.com';
const TIMEZONE = 'Asia/Bangkok';

function normalizeCalendarKey(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/ks[a-zA-Z0-9]{16,}/i);
  return match ? match[0] : trimmed;
}

function readConnection(value: unknown) {
  const source = (value || {}) as { apiKey?: unknown; calendarKey?: unknown };
  const apiKey = typeof source.apiKey === 'string' ? source.apiKey.trim() : '';
  const calendarKey =
    typeof source.calendarKey === 'string'
      ? normalizeCalendarKey(source.calendarKey)
      : '';
  if (!apiKey || !/^ks[a-zA-Z0-9]{16,}$/i.test(calendarKey)) return null;
  return { apiKey, calendarKey } as Connection;
}

function readMapping(value: unknown) {
  const source = (value || {}) as Partial<Record<CategoryName, unknown>>;
  const mapping = {} as Mapping;
  for (const category of CATEGORIES) {
    const id = Number(source[category]);
    if (!Number.isFinite(id) || id <= 0) return null;
    mapping[category] = id;
  }
  return mapping;
}

class TeamupError extends Error {
  status: number;
  constructor(status: number) {
    super(`Teamup request failed (${status})`);
    this.status = status;
  }
}

async function teamupRequest<T>(
  connection: Connection,
  path: string,
  init: RequestInit = {}
) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Teamup-Token', connection.apiKey);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(
    `${TEAMUP_BASE}/${encodeURIComponent(connection.calendarKey)}${path}`,
    { ...init, headers }
  );
  const text = await response.text();
  if (!response.ok) throw new TeamupError(response.status);
  return (text ? JSON.parse(text) : {}) as T;
}

async function checkApiKey(apiKey: string) {
  const response = await fetch(`${TEAMUP_BASE}/check-access`, {
    headers: { Accept: 'application/json', 'Teamup-Token': apiKey },
  });
  if (!response.ok) throw new TeamupError(response.status);
  const payload = (await response.json()) as { access?: string };
  if (payload.access !== 'ok') throw new TeamupError(401);
}

function describeTeamupError(caught: unknown) {
  const status = caught instanceof TeamupError ? caught.status : 0;
  if (status === 401)
    return { message: 'Teamup rejected the API key.', status: 401 };
  if (status === 403)
    return {
      message: 'The calendar link does not allow this operation.',
      status: 403,
    };
  if (status === 404)
    return { message: 'Teamup could not find this calendar key.', status: 404 };
  return { message: 'Teamup could not be reached or verified.', status: 502 };
}

function parseTeamupTime(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return { date: match[1], minutes: Number(match[2]) * 60 + Number(match[3]) };
}

function formatTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function toBangkokDateTime(date: string, minutes: number) {
  return `${date}T${formatTime(minutes)}:00+07:00`;
}

function monthBounds(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 2000 || year > 2100 || monthNumber < 1 || monthNumber > 12)
    return null;
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(last).padStart(2, '0')}`,
  };
}

function eventCategories(value: unknown, mapping: Mapping) {
  if (!Array.isArray(value)) return [] as CategoryName[];
  return CATEGORIES.filter(category =>
    value.some(item => Number(item) === mapping[category])
  );
}

function validateEvents(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200)
    return null;
  const result: Array<{
    date: string;
    start: number;
    end: number;
    title: string;
    categories: CategoryName[];
  }> = [];
  for (const raw of value as IncomingEvent[]) {
    const date = typeof raw.date === 'string' ? raw.date.trim() : '';
    const title =
      typeof raw.title === 'string' ? raw.title.trim().slice(0, 500) : '';
    const start = Number(raw.start);
    const end = Number(raw.end);
    const categories = Array.isArray(raw.categories)
      ? (Array.from(
          new Set(
            raw.categories.filter(
              item =>
                typeof item === 'string' &&
                CATEGORIES.includes(item as CategoryName)
            )
          )
        ) as CategoryName[])
      : [];
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !title ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > 1440 ||
      end <= start ||
      !categories.length
    )
      return null;
    if (start < 13 * 60 && end > 12 * 60 && !categories.includes('Leave'))
      return null;
    result.push({ date, start, end, title, categories });
  }
  return result;
}

const attendanceSchema = {
  type: 'object',
  properties: {
    monthLabel: { type: 'string' },
    records: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          scannerText: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['date', 'scannerText', 'note'],
      },
    },
  },
  required: ['monthLabel', 'records'],
};

function normalizeOcr(data: unknown) {
  const source = (data || {}) as {
    records?: Array<{ date?: unknown; scannerText?: unknown; note?: unknown }>;
  };
  const currentYear = new Date().getFullYear();
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const rows = (Array.isArray(source.records) ? source.records : [])
    .map(record => {
      const rawDate = typeof record.date === 'string' ? record.date.trim() : '';
      let date = rawDate;
      const parsed = rawDate.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
      if (parsed) {
        const month = months[parsed[2].slice(0, 3).toLowerCase()];
        if (month)
          date = `${Number(parsed[3]) > 2400 ? Number(parsed[3]) - 543 : Number(parsed[3])}-${String(month).padStart(2, '0')}-${String(Number(parsed[1])).padStart(2, '0')}`;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const simple = rawDate.match(/^(\d{1,2})[\/-](\d{1,2})$/);
        if (simple)
          date = `${currentYear}-${String(Number(simple[2])).padStart(2, '0')}-${String(Number(simple[1])).padStart(2, '0')}`;
      }
      const scanner =
        typeof record.scannerText === 'string' ? record.scannerText : '';
      const times = scanner.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || [];
      const normalize = (value: string) => {
        const [h, m] = value.split(':');
        return `${h.padStart(2, '0')}:${m}`;
      };
      let checkIn = '—';
      let checkOut = '—';
      if (times.length >= 2) {
        checkIn = normalize(times[0]);
        checkOut = normalize(times[1]);
      } else if (times.length === 1) {
        const value = normalize(times[0]);
        const hour = Number(value.slice(0, 2));
        if (hour < 12) checkIn = value;
        else checkOut = value;
      }
      return {
        date,
        checkIn,
        checkOut,
        note: typeof record.note === 'string' ? record.note.trim() : '',
      };
    })
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
  return rows;
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

  'POST /api/teamup/discover': [
    async ({ body }) => {
      const payload = body as { connection?: unknown };
      const connection = readConnection(payload.connection);
      if (!connection)
        return error(
          'Valid Teamup API key and calendar key are required.',
          400
        );
      try {
        await checkApiKey(connection.apiKey);
        let subcalendars: Array<{
          id?: unknown;
          name?: unknown;
          active?: unknown;
          readonly?: unknown;
        }> = [];
        let calendarName = 'Teamup Calendar';
        try {
          const response = await teamupRequest<{
            subcalendars?: typeof subcalendars;
          }>(connection, '/subcalendars?includeInactive=false');
          subcalendars = Array.isArray(response.subcalendars)
            ? response.subcalendars
            : [];
        } catch (caught) {
          if (!(caught instanceof TeamupError) || caught.status !== 403)
            throw caught;
          const response = await teamupRequest<{
            configuration?: {
              name?: unknown;
              subcalendars?: typeof subcalendars;
            };
          }>(connection, '/configuration');
          subcalendars = Array.isArray(response.configuration?.subcalendars)
            ? response.configuration?.subcalendars || []
            : [];
          if (
            typeof response.configuration?.name === 'string' &&
            response.configuration.name.trim()
          )
            calendarName = response.configuration.name.trim();
        }
        const usable = subcalendars
          .map(item => ({
            id: Number(item.id),
            name: typeof item.name === 'string' ? item.name.trim() : '',
            readonly: item.readonly === true,
          }))
          .filter(
            item => Number.isFinite(item.id) && item.name && !item.readonly
          );
        return json({ calendarName, subcalendars: usable });
      } catch (caught) {
        const diagnosis = describeTeamupError(caught);
        return error(diagnosis.message, diagnosis.status);
      }
    },
  ],

  'POST /api/teamup/month-events': [
    async ({ body }) => {
      const payload = body as {
        connection?: unknown;
        mapping?: unknown;
        month?: unknown;
      };
      const connection = readConnection(payload.connection);
      const mapping = readMapping(payload.mapping);
      const month =
        typeof payload.month === 'string' ? payload.month.trim() : '';
      const bounds = monthBounds(month);
      if (!connection || !mapping || !bounds)
        return error(
          'Connection, mapping, and YYYY-MM month are required.',
          400
        );
      try {
        const response = await teamupRequest<{ events?: TeamupRawEvent[] }>(
          connection,
          `/events?startDate=${encodeURIComponent(bounds.start)}&endDate=${encodeURIComponent(bounds.end)}&tz=${encodeURIComponent(TIMEZONE)}`
        );
        const events: Array<{
          id: string;
          date: string;
          start: number;
          end: number;
          title: string;
          categories: CategoryName[];
          allDay: boolean;
        }> = [];
        (response.events || []).forEach((raw, index) => {
          const categories = eventCategories(raw.subcalendar_ids, mapping);
          if (!categories.length) return;
          const startValue = parseTeamupTime(raw.start_dt);
          if (!startValue || !startValue.date.startsWith(`${month}-`)) return;
          const endValue = parseTeamupTime(raw.end_dt);
          const allDay =
            raw.all_day === true || raw.all_day === 1 || raw.all_day === '1';
          const start = allDay ? 0 : startValue.minutes;
          let end = allDay
            ? 1440
            : endValue?.date === startValue.date
              ? endValue.minutes
              : 1440;
          if (end <= start) end = Math.min(1440, start + 1);
          events.push({
            id: String(raw.id ?? `event-${index}`),
            date: startValue.date,
            start,
            end,
            title:
              typeof raw.title === 'string' && raw.title.trim()
                ? raw.title.trim()
                : 'Untitled event',
            categories,
            allDay,
          });
        });
        events.sort(
          (a, b) => a.date.localeCompare(b.date) || a.start - b.start
        );
        return json({ month, events });
      } catch (caught) {
        const diagnosis = describeTeamupError(caught);
        return error(diagnosis.message, diagnosis.status);
      }
    },
  ],

  'POST /api/teamup/events': [
    async ({ body }) => {
      const payload = body as {
        connection?: unknown;
        mapping?: unknown;
        events?: unknown;
      };
      const connection = readConnection(payload.connection);
      const mapping = readMapping(payload.mapping);
      const events = validateEvents(payload.events);
      if (!connection || !mapping || !events)
        return error(
          'Valid connection, mapping, and events are required.',
          400
        );
      const createdIds: string[] = [];
      try {
        for (const event of events) {
          const result = await teamupRequest<{
            event?: { id?: string | number };
            id?: string | number;
          }>(connection, `/events?tz=${encodeURIComponent(TIMEZONE)}`, {
            method: 'POST',
            body: JSON.stringify({
              start_dt: toBangkokDateTime(event.date, event.start),
              end_dt: toBangkokDateTime(event.date, event.end),
              all_day: false,
              subcalendar_ids: event.categories.map(
                category => mapping[category]
              ),
              title: event.title,
              location: '',
              who: '',
              notes: 'Created with BURANADEE Teamup Assistant Public Edition.',
            }),
          });
          const id = result.event?.id ?? result.id;
          if (id !== undefined && id !== null) createdIds.push(String(id));
        }
        return json({ created: events.length, eventIds: createdIds }, 201);
      } catch (caught) {
        for (const id of [...createdIds].reverse()) {
          try {
            await teamupRequest(
              connection,
              `/events/${encodeURIComponent(id)}`,
              { method: 'DELETE' }
            );
          } catch {
            /* rollback best effort */
          }
        }
        const diagnosis = describeTeamupError(caught);
        return error(
          `${diagnosis.message} Partial writes were rolled back where possible.`,
          diagnosis.status
        );
      }
    },
  ],

  'POST /api/translate-work-lines': [
    async ({ body }) => {
      const payload = body as { lines?: unknown };
      if (
        !Array.isArray(payload.lines) ||
        payload.lines.length === 0 ||
        payload.lines.length > 30
      )
        return error('Provide 1-30 work lines.', 400);
      const lines = payload.lines.map(item =>
        typeof item === 'string' ? item.trim() : ''
      );
      if (lines.some(line => !line || line.length > 500))
        return error('Each work line must be 1-500 characters.', 400);
      try {
        const result = await ai.generate({
          system:
            'Translate Thai or mixed Thai-English architecture, construction, design, meeting, and site-work descriptions into concise but detailed English calendar event titles. Preserve actions, systems, rooms, floors, objects, project context, and names. Translate คุณ as Khun. Do not invent details. Return titles in the same order.',
          prompt: JSON.stringify({ lines }),
          schema: {
            type: 'object',
            properties: {
              titles: { type: 'array', items: { type: 'string' } },
            },
            required: ['titles'],
          },
          thinkingMode: 'FAST',
          temperature: 0.1,
          maxTokens: 2400,
        });
        const parsed = JSON.parse(
          result.text
            .trim()
            .replace(/^```json\s*/i, '')
            .replace(/```$/i, '')
        ) as { titles?: unknown };
        if (
          !Array.isArray(parsed.titles) ||
          parsed.titles.length !== lines.length
        )
          return error('Unexpected translation result.', 502);
        return json({
          titles: parsed.titles.map(item =>
            typeof item === 'string' ? item.trim().slice(0, 500) : ''
          ),
        });
      } catch {
        return error('Detailed translation is temporarily unavailable.', 502);
      }
    },
  ],

  'POST /api/attendance/ocr': [
    async ({ body }) => {
      const payload = body as { image?: { data?: string; mimeType?: string } };
      if (!payload.image?.data || !payload.image.mimeType)
        return error('Attendance image is required.', 400);
      try {
        const result = await ai.ocr({
          images: [
            { data: payload.image.data, mimeType: payload.image.mimeType },
          ],
          schema: attendanceSchema,
          thinkingMode: 'FAST',
          maxRetries: 2,
          maxTokens: 4096,
          temperature: 0.05,
          system:
            'Read employee attendance images accurately. Never invent missing times.',
          prompt:
            'Extract every visible dated row. Return date preferably as DD Mon YYYY or YYYY-MM-DD. scannerText must contain only the actual check-in/check-out scanner times for that row. note contains visible leave/overtime/outside-work text if present. If a value is missing return an empty string.',
        });
        return json({ records: normalizeOcr(result.data) });
      } catch {
        return error('Could not read attendance screenshot.', 500);
      }
    },
  ],
});
