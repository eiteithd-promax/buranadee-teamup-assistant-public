import { ai, error, json, router, secrets } from '@appdeploy/sdk';

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
  subcalendar_id?: unknown;
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
  const ids = Array.isArray(value) ? value : value == null ? [] : [value];
  return CATEGORIES.filter(category => ids.some(item => Number(item) === mapping[category]));
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


const TEAMUP_LOCAL_BRIDGE = 'https://idjzkestgnbkybvlzwij.supabase.co/functions/v1/teamup-bridge';
const LOCAL_AI_SITE_KEY = 'TEAMUP_LOCAL_SITE_KEY';
const TRANSLATION_SYSTEM =
  'Translate Thai or mixed Thai-English architecture, construction, design, meeting, and site-work descriptions into detailed English event titles. Preserve actions, systems, rooms, floors, objects, project context, and names. Translate คุณ as Khun. Do not invent details. Return titles in the same order.';
const ATTENDANCE_SYSTEM =
  'Read Thai employee attendance images accurately. Never invent missing times. Respect the exact source column.';
const ATTENDANCE_PROMPT =
  'Extract every visible dated row in a JSON object with monthLabel and records array. Dates as DD Mon YYYY or YYYY-MM-DD. Use ONLY the scanner-machine time column เวลาจากเครื่องสแกน to identify check-in/check-out. NEVER use HR calculated time column เวลาผ่านการคำนวณHR. Preserve visible overtime and outside-work remarks; overtime is not Leave. If missing return an empty string. Each record must contain date,checkIn,checkOut,note.';
type QueuedAiJob = { jobId: string; token: string };

async function callLocalBridge(op: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const names = await secrets.listSecretNames();
  if (!names.includes(LOCAL_AI_SITE_KEY)) throw new Error('Public Local AI credential not configured.');
  const siteKey = await secrets.readSecret(LOCAL_AI_SITE_KEY);
  const response = await fetch(TEAMUP_LOCAL_BRIDGE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-teamup-site-key': siteKey },
    body: JSON.stringify({ op, ...payload }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('Local AI bridge HTTP ' + response.status);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Local AI bridge returned non-object.');
  return data as Record<string, unknown>;
}

async function submitLocalFirst(
  action: 'translate_work_lines' | 'attendance_ocr',
  payload: Record<string, unknown>
): Promise<QueuedAiJob | null> {
  try {
    const worker = await callLocalBridge('worker_status');
    if (worker.online !== true) return null;
    const reply = await callLocalBridge('submit', { action, payload });
    if (typeof reply.jobId !== 'string' || typeof reply.token !== 'string') return null;
    return { jobId: reply.jobId, token: reply.token };
  } catch (caught) {
    console.warn('Local AI unavailable; using cloud AI backup.', caught instanceof Error ? caught.message : 'unknown');
    return null;
  }
}

function normalizedLocalOcr(value: unknown) {
  const result = (value || {}) as { records?: unknown };
  if (!Array.isArray(result.records)) return [];
  const rows = result.records.map(record => {
    const item = (record || {}) as Record<string, unknown>;
    const checkIn = typeof item.checkIn === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(item.checkIn) ? item.checkIn : '';
    const checkOut = typeof item.checkOut === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(item.checkOut) ? item.checkOut : '';
    return {
      date: typeof item.date === 'string' ? item.date : '',
      scannerText: [checkIn, checkOut].filter(Boolean).join(' '),
      note: typeof item.note === 'string' ? item.note : '',
    };
  });
  return normalizeOcr({ records: rows });
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'GET /api/local-ai/status': [async () => {
    try {
      const worker = await callLocalBridge('worker_status');
      return json({ mode: 'LOCAL_FIRST', localOnline: worker.online === true });
    } catch {
      return json({ mode: 'LOCAL_FIRST', localOnline: false });
    }
  }],
  'POST /api/ai/job-status': [async ({ body }) => {
    const payload = (body || {}) as { jobId?: unknown; token?: unknown };
    if (typeof payload.jobId !== 'string' || typeof payload.token !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(payload.jobId) || !/^[0-9a-f-]{36}$/i.test(payload.token)) {
      return error('Invalid Local AI job reference.', 400);
    }
    try {
      const state = await callLocalBridge('status', { jobId: payload.jobId, token: payload.token });
      if (state.status === 'completed') {
        const result = (state.result || {}) as Record<string, unknown>;
        if (Array.isArray(result.records)) {
          const records = normalizedLocalOcr(result);
          if (!records.length) return json({ status: 'failed', message: 'No readable scanner-time rows.' });
          return json({ status: 'completed', result: { records } });
        }
        if (Array.isArray(result.titles)) {
          const titles = result.titles;
          if (!titles.length || titles.some(title => typeof title !== 'string' || !title.trim())) {
            return json({ status: 'failed', message: 'Local AI translation output invalid.' });
          }
          return json({ status: 'completed', result: { titles } });
        }
        return json({ status: 'failed', message: 'Local AI output invalid.' });
      }
      if (state.status === 'failed') return json({ status: 'failed', message: 'Local AI worker failed to process the request.' });
      return json({ status: 'pending' }, 202);
    } catch {
      return json({ status: 'failed', message: 'Local AI worker connection lost.' });
    }
  }],

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
        type CalendarConfiguration = {
          identity?: { title?: unknown };
          user?: {
            name?: unknown;
            username?: unknown;
            display_name?: unknown;
            email?: unknown;
          } | null;
          link?: { name?: unknown } | null;
          date_time?: { tz?: unknown };
          name?: unknown;
          subcalendars?: Array<{
            id?: unknown;
            name?: unknown;
            active?: unknown;
            readonly?: unknown;
          }>;
        };
        let configuration: CalendarConfiguration | undefined;
        try {
          const result = await teamupRequest<{
            configuration?: CalendarConfiguration;
          }>(connection, '/configuration');
          configuration = result.configuration;
        } catch (caught) {
          if (
            !(caught instanceof TeamupError) ||
            (caught.status !== 403 && caught.status !== 404)
          )
            throw caught;
        }
        let subcalendars = configuration?.subcalendars || [];
        try {
          const result = await teamupRequest<{
            subcalendars?: typeof subcalendars;
          }>(connection, '/subcalendars?includeInactive=false');
          if (Array.isArray(result.subcalendars))
            subcalendars = result.subcalendars;
        } catch (caught) {
          if (
            !(caught instanceof TeamupError) ||
            caught.status !== 403 ||
            !Array.isArray(configuration?.subcalendars)
          )
            throw caught;
        }
        const clean = (value: unknown) =>
          typeof value === 'string' ? value.trim() : '';
        const calendarName =
          clean(configuration?.identity?.title) ||
          clean(configuration?.name) ||
          'Teamup Calendar';
        const viewerName =
          clean(configuration?.user?.name) ||
          clean(configuration?.user?.display_name) ||
          clean(configuration?.user?.username);
        const viewerEmail = clean(configuration?.user?.email);
        const linkName = clean(configuration?.link?.name);
        const timeZone = clean(configuration?.date_time?.tz) || TIMEZONE;
        const usable = subcalendars
          .map(item => ({
            id: Number(item.id),
            name: typeof item.name === 'string' ? item.name.trim() : '',
            readonly: item.readonly === true,
          }))
          .filter(item => Number.isFinite(item.id) && item.name);
        return json({
          calendarName,
          viewerName,
          viewerEmail,
          linkName,
          timeZone,
          subcalendars: usable,
        });
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
          subcalendarIds: number[];
        }> = [];
        (response.events || []).forEach((raw, index) => {
          const subcalendarIds = (Array.isArray(raw.subcalendar_ids) ? raw.subcalendar_ids : raw.subcalendar_id == null ? [] : [raw.subcalendar_id]).map(Number).filter(Number.isFinite);
          const categories = eventCategories(subcalendarIds, mapping);
          const startValue = parseTeamupTime(raw.start_dt);
          if (!startValue) return;
          const endValue = parseTeamupTime(raw.end_dt);
          if (endValue && endValue.date < bounds.start) return;
          if (startValue.date > bounds.end) return;
          const allDay =
            raw.all_day === true || raw.all_day === 1 || raw.all_day === '1';
          const date = startValue.date < bounds.start ? bounds.start : startValue.date;
          const start = allDay || date !== startValue.date ? 0 : startValue.minutes;
          let end = allDay
            ? 1440
            : endValue?.date === date
              ? endValue.minutes
              : 1440;
          if (end <= start) end = Math.min(1440, start + 1);
          events.push({
            id: String(raw.id ?? `event-${index}`),
            date,
            start,
            end,
            title:
              typeof raw.title === 'string' && raw.title.trim()
                ? raw.title.trim()
                : 'Untitled event',
            categories,
            allDay,
            subcalendarIds,
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
      const payload = body as { lines?: unknown; forceAppDeploy?: boolean };
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
      if (payload.forceAppDeploy !== true) {
        const local = await submitLocalFirst('translate_work_lines', {
          system: TRANSLATION_SYSTEM,
          prompt: JSON.stringify({ lines }),
        });
        if (local) return json({ pending: true, ...local, provider: 'LOCAL' }, 202);
      }
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
      const payload = body as { image?: { data?: string; mimeType?: string }; forceAppDeploy?: boolean };
      if (!payload.image?.data || !payload.image.mimeType)
        return error('Attendance image is required.', 400);
      if (payload.forceAppDeploy !== true) {
        const local = await submitLocalFirst('attendance_ocr', {
          system: ATTENDANCE_SYSTEM,
          prompt: ATTENDANCE_PROMPT,
          images: [{ data: payload.image.data, mimeType: payload.image.mimeType }],
        });
        if (local) return json({ pending: true, ...local, provider: 'LOCAL' }, 202);
      }
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
        const records = normalizeOcr(result.data);
        if (!records.length) return error('No scanner rows could be detected in the image.', 422);
        return json({ records });
      } catch {
        return error('Could not read attendance screenshot.', 500);
      }
    },
  ],
});
