import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, image } from '@appdeploy/client';
import { PDFDocument } from 'pdf-lib';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  FileText,
  Home,
  ImagePlus,
  Layers3,
  Link2,
  LoaderCircle,
  Menu,
  Printer,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import './public.css';
import './private-workspace.css';
import './private-pdf-ui.css';

type CategoryName =
  | 'Outside'
  | 'Follow Up'
  | 'Job Routine'
  | 'Meeting'
  | 'Leave';
type ViewName =
  | 'landing'
  | 'setup'
  | 'schedule'
  | 'calendar'
  | 'attendance'
  | 'pdf'
  | 'guide'
  | 'settings';

type WorkEvent = {
  id: string;
  date: string;
  start: number;
  end: number;
  title: string;
  source: string;
  categories: CategoryName[];
};

type TeamupEvent = {
  id: string;
  date: string;
  start: number;
  end: number;
  title: string;
  categories: CategoryName[];
  allDay?: boolean;
};

type Subcalendar = { id: number; name: string; readonly?: boolean };
type Mapping = Record<CategoryName, number>;
type Connection = {
  apiKey: string;
  calendarKey: string;
  mapping: Mapping;
  calendarName: string;
  printName?: string;
  remembered: boolean;
  demo?: boolean;
};

type AttendanceRow = {
  date: string;
  checkIn: string;
  checkOut: string;
  note: string;
};
type PdfPrintIdentity = {
  calendarTitle: string;
  accountLabel: string;
  timeZone: string;
};
type PdfDay = {
  date: string;
  events: TeamupEvent[];
  printIdentity?: PdfPrintIdentity;
};
type PdfJob = {
  id: string;
  start: string;
  end: string;
  createdAt: string;
  pages: PdfDay[];
  printIdentity?: PdfPrintIdentity;
};

type Toast = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

const CATEGORIES: CategoryName[] = [
  'Outside',
  'Follow Up',
  'Job Routine',
  'Meeting',
  'Leave',
];
const CATEGORY_META: Record<
  CategoryName,
  { label: string; color: string; soft: string }
> = {
  Outside: { label: 'Work Outside', color: '#ff8849', soft: '#fff0e7' },
  'Follow Up': {
    label: 'Follow Up / Review',
    color: '#e1b52b',
    soft: '#fff7d9',
  },
  'Job Routine': {
    label: 'Job Routine / To do',
    color: '#1689aa',
    soft: '#e7f7fb',
  },
  Meeting: { label: 'Meeting', color: '#82b343', soft: '#eef8df' },
  Leave: { label: 'Holiday / Leave', color: '#e95d92', soft: '#fdeaf2' },
};
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  มค: 1,
  มกราคม: 1,
  feb: 2,
  february: 2,
  กพ: 2,
  กุมภาพันธ์: 2,
  mar: 3,
  march: 3,
  มีค: 3,
  มีนาคม: 3,
  apr: 4,
  april: 4,
  เมย: 4,
  เมษายน: 4,
  may: 5,
  พค: 5,
  พฤษภาคม: 5,
  jun: 6,
  june: 6,
  มิย: 6,
  มิถุนายน: 6,
  jul: 7,
  july: 7,
  กค: 7,
  กรกฎาคม: 7,
  aug: 8,
  august: 8,
  สค: 8,
  สิงหาคม: 8,
  sep: 9,
  sept: 9,
  september: 9,
  กย: 9,
  กันยายน: 9,
  oct: 10,
  october: 10,
  ตค: 10,
  ตุลาคม: 10,
  nov: 11,
  november: 11,
  พย: 11,
  พฤศจิกายน: 11,
  dec: 12,
  december: 12,
  ธค: 12,
  ธันวาคม: 12,
};
const SAMPLE_INPUT = '17/SEP\n09.30-12.00 ไปตรวจงานโครงการตัวอย่าง\n13.00-15.00 เขียนแบบห้องตัวอย่าง\n15.00-16.00 ประชุมประสานงานโครงการ';
const CONNECTION_KEY = 'buranadee-teamup-public-connection-v1';
const PDF_QUEUE_KEY = 'buranadee-teamup-public-pdf-v1';

function bangkokTodayIso() {
  const [day, month, year] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('/');
  return `${year}-${month}-${day}`;
}

function isoParts(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

function toIso(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function friendlyDate(iso: string) {
  const { year, month, day } = isoParts(iso);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

function fullDate(iso: string) {
  const { year, month, day } = isoParts(iso);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
  return `${weekday} ${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

function formatTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function normalizeMonthToken(value: string) {
  return value.toLowerCase().replace(/[.\s]/g, '');
}

function dateFromIso(iso: string) {
  const { year, month, day } = isoParts(iso);
  return new Date(year, month - 1, day);
}

function parseDateHeader(row: string) {
  const cleaned = row.replace(/^วันที่\s*/i, '').trim();
  const match = cleaned.match(
    /^(\d{1,2}(?:\s*[-–]\s*\d{1,2})?(?:\s*,\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?)*)\s*(?:\/\s*)?([ก-๙A-Za-z.]+|\d{1,2})(?:\s*(?:\/\s*)?(\d{4}))?$/i
  );
  if (!match) return [] as string[];
  const monthToken = normalizeMonthToken(match[2]);
  const month = /^\d{1,2}$/.test(monthToken)
    ? Number(monthToken)
    : MONTH_MAP[monthToken];
  if (!month || month > 12) return [];
  const rawYear = match[3]
    ? Number(match[3])
    : Number(bangkokTodayIso().slice(0, 4));
  const year = rawYear > 2400 ? rawYear - 543 : rawYear;
  const result: string[] = [];
  match[1]
    .replace(/\s/g, '')
    .split(',')
    .forEach(token => {
      if (/[-–]/.test(token)) {
        const [startText, endText] = token.split(/[-–]/);
        const start = Number(startText);
        const end = Number(endText);
        for (let day = start; day <= end; day += 1)
          if (validDate(year, month, day)) result.push(toIso(year, month, day));
      } else {
        const day = Number(token);
        if (validDate(year, month, day)) result.push(toIso(year, month, day));
      }
    });
  return Array.from(new Set(result)).sort();
}

const TIME_RE =
  /(\d{1,2})(?:[:.](\d{1,2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{1,2}))?/;

function toMinutes(hour: string, minute?: string) {
  return Number(hour) * 60 + Number(minute || 0);
}

function includesAny(text: string, words: string[]) {
  return words.some(word => text.toLowerCase().includes(word.toLowerCase()));
}

function detectCategories(text: string): CategoryName[] {
  const categories: CategoryName[] = [];
  const contractorMeeting = includesAny(text, [
    'ประชุมผู้รับเหมา',
    'contractor meeting',
  ]);
  if (
    includesAny(text, [
      'ลาป่วย',
      'ลากิจ',
      'พักร้อน',
      'sick leave',
      'personal leave',
      'vacation',
    ])
  )
    categories.push('Leave');
  if (!contractorMeeting && includesAny(text, ['ประชุม', 'meeting', 'คุยงาน']))
    categories.push('Meeting');
  if (
    contractorMeeting ||
    includesAny(text, ['หน้างาน', 'site', 'supplier', 'นอกสถานที่', 'ไปพบ'])
  )
    categories.push('Outside');
  if (
    includesAny(text, [
      'เขียนแบบ',
      'ทำแบบ',
      'แก้แบบ',
      '3d',
      'render',
      'drawing',
      'design',
    ])
  )
    categories.push('Job Routine');
  if (
    includesAny(text, [
      'ติดตาม',
      'ตรวจงาน',
      'ควบคุมงาน',
      'survey',
      'review',
      'inspection',
    ])
  )
    categories.push('Follow Up');
  return categories.length ? Array.from(new Set(categories)) : ['Job Routine'];
}

function fallbackEnglishTitle(text: string, categories: CategoryName[]) {
  const person = text.match(/คุณ\s*([A-Za-z][A-Za-z0-9-]*)/i)?.[1];
  const actions: string[] = [];
  if (includesAny(text, ['ตรวจงาน', 'inspection']))
    actions.push('Site Inspection');
  if (includesAny(text, ['ประชุมผู้รับเหมา']))
    actions.push('Contractor Meeting');
  else if (includesAny(text, ['ประชุม', 'meeting'])) actions.push('Meeting');
  if (includesAny(text, ['แก้แบบ'])) actions.push('Drawing Revision');
  else if (includesAny(text, ['เขียนแบบ', 'ทำแบบ', 'drawing']))
    actions.push('Drawing');
  if (includesAny(text, ['3d'])) actions.push('3D Design');
  if (!actions.length && categories.includes('Leave')) actions.push('Leave');
  if (!actions.length && categories.includes('Outside'))
    actions.push('On-site Work');
  if (!actions.length) actions.push('Work Task');
  const details: string[] = [];
  if (includesAny(text, ['ห้องซักรีด', 'laundry']))
    details.push('Laundry Room');
  if (includesAny(text, ['ดาดฟ้า', 'rooftop'])) details.push('Rooftop Floor');
  if (includesAny(text, ['ระบบแอร์', 'air conditioning']))
    details.push('Air-Conditioning System');
  if (includesAny(text, ['ตู้รองเท้า'])) details.push('Shoe Cabinet');
  return [
    Array.from(new Set(actions)).join(' & '),
    details.join(' / '),
    person ? `Khun ${person}${text.includes('บ้าน') ? ' House' : ''}` : '',
  ]
    .filter(Boolean)
    .join(' - ');
}

function splitLunch(event: WorkEvent) {
  if (event.categories.includes('Leave')) return [event];
  const lunchStart = 12 * 60;
  const lunchEnd = 13 * 60;
  if (event.end <= lunchStart || event.start >= lunchEnd) return [event];
  const parts: WorkEvent[] = [];
  if (event.start < lunchStart)
    parts.push({ ...event, id: `${event.id}-am`, end: lunchStart });
  if (event.end > lunchEnd)
    parts.push({ ...event, id: `${event.id}-pm`, start: lunchEnd });
  return parts;
}

function parseClock(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function attendanceMap(rows: AttendanceRow[]) {
  return new Map(rows.map(row => [row.date, row]));
}

function parseSchedule(text: string, attendanceRows: AttendanceRow[]) {
  const rows = text
    .split(/\n+/)
    .map(row => row.trim())
    .filter(Boolean);
  const dates = rows.length ? parseDateHeader(rows[0]) : [];
  const workRows = dates.length ? rows.slice(1) : rows;
  const selectedDates = dates.length ? dates : [bangkokTodayIso()];
  if (!workRows.length)
    return {
      events: [] as WorkEvent[],
      message: 'เพิ่มรายละเอียดงานอย่างน้อย 1 บรรทัด',
    };
  const timed = workRows.some(row => TIME_RE.test(row));
  const untimed = workRows.some(row => !TIME_RE.test(row));
  if (timed && untimed)
    return {
      events: [] as WorkEvent[],
      message:
        'ใส่เวลาให้ครบทุกบรรทัด หรือไม่ใส่เวลาเลยเพื่อใช้ Attendance Auto-Time',
    };
  const events: WorkEvent[] = [];
  if (timed) {
    selectedDates.forEach(date =>
      workRows.forEach((row, index) => {
        const match = row.match(TIME_RE);
        if (!match) return;
        const start = toMinutes(match[1], match[2]);
        const end = toMinutes(match[3], match[4]);
        if (end <= start) return;
        const source = row.replace(match[0], '').trim();
        const categories = detectCategories(source);
        events.push(
          ...splitLunch({
            id: `${date}-${index}-${start}`,
            date,
            start,
            end,
            source,
            categories,
            title: fallbackEnglishTitle(source, categories),
          })
        );
      })
    );
  } else {
    const byDate = attendanceMap(attendanceRows);
    for (const date of selectedDates) {
      const attendance = byDate.get(date);
      const start = attendance ? parseClock(attendance.checkIn) : null;
      const end = attendance ? parseClock(attendance.checkOut) : null;
      if (start === null || end === null || end <= start)
        return {
          events: [] as WorkEvent[],
          message: `ไม่พบเวลาเข้า-ออกจาก Attendance สำหรับ ${friendlyDate(date)}`,
        };
      const spans: Array<[number, number]> = [];
      if (start < 12 * 60) spans.push([start, Math.min(end, 12 * 60)]);
      if (end > 13 * 60) spans.push([Math.max(start, 13 * 60), end]);
      const total = spans.reduce((sum, [a, b]) => sum + b - a, 0);
      workRows.forEach((source, index) => {
        const fromOffset = Math.floor((total * index) / workRows.length);
        const toOffset =
          index === workRows.length - 1
            ? total
            : Math.floor((total * (index + 1)) / workRows.length);
        let cursor = 0;
        spans.forEach(([a, b], segment) => {
          const length = b - a;
          const localFrom = Math.max(0, fromOffset - cursor);
          const localTo = Math.min(length, toOffset - cursor);
          if (localTo > localFrom) {
            const categories = detectCategories(source);
            events.push({
              id: `${date}-${index}-${segment}`,
              date,
              start: a + localFrom,
              end: a + localTo,
              source,
              categories,
              title: fallbackEnglishTitle(source, categories),
            });
          }
          cursor += length;
        });
      });
    }
  }
  return {
    events: events.sort(
      (a, b) => a.date.localeCompare(b.date) || a.start - b.start
    ),
    message: '',
  };
}

function bestGuessMapping(subcalendars: Subcalendar[]) {
  const normalized = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const pick = (terms: string[]) =>
    subcalendars.find(item =>
      terms.some(term => normalized(item.name).includes(term))
    )?.id || 0;
  return {
    Outside: pick(['workoutside', 'outside', 'exhibition', 'site']),
    'Follow Up': pick(['followup', 'review', 'observe', 'survey']),
    'Job Routine': pick(['jobroutine', 'todo', 'routine']),
    Meeting: pick(['meeting']),
    Leave: pick(['holiday', 'leave']),
  } as Mapping;
}

function parseNaturalRange(text: string) {
  const today = bangkokTodayIso();
  const currentYear = isoParts(today).year;
  const latest = /(ล่าสุด|วันนี้|ปัจจุบัน|today|latest|now)/i.test(text);
  const matches = Array.from(
    text.matchAll(
      /(\d{1,2})\s*(?:[\/\-]\s*)?([A-Za-z.ก-๙]+|\d{1,2})(?:\s*(?:[\/\-]\s*)?(\d{4}))?/gi
    )
  );
  const dates = matches
    .map(match => {
      const monthToken = normalizeMonthToken(match[2]);
      const month = /^\d{1,2}$/.test(monthToken)
        ? Number(monthToken)
        : MONTH_MAP[monthToken];
      const rawYear = match[3] ? Number(match[3]) : currentYear;
      const year = rawYear > 2400 ? rawYear - 543 : rawYear;
      const day = Number(match[1]);
      return month && validDate(year, month, day)
        ? { iso: toIso(year, month, day), explicitYear: Boolean(match[3]) }
        : null;
    })
    .filter((value): value is { iso: string; explicitYear: boolean } =>
      Boolean(value)
    );
  if (!dates.length)
    return { error: 'ระบุวันเริ่ม เช่น 20 AUG หรือ 20 ส.ค.' } as const;
  let start = dates[0].iso;
  const end = latest ? today : dates[1]?.iso || start;
  if (latest && !dates[0].explicitYear && start > today) {
    const parts = isoParts(start);
    start = toIso(parts.year - 1, parts.month, parts.day);
  }
  if (start > end)
    return { error: 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด' } as const;
  return { start, end } as const;
}

function monthKeysBetween(start: string, end: string) {
  const first = isoParts(start);
  const last = isoParts(end);
  const keys: string[] = [];
  let year = first.year;
  let month = first.month;
  while (year < last.year || (year === last.year && month <= last.month)) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function buildCalendar(reference: string) {
  const date = dateFromIso(reference);
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return {
    year,
    month,
    label: `${MONTHS[month]} ${year}`,
    cells: Array.from({ length: 42 }, (_, index) => {
      const day = index - firstOffset + 1;
      return day >= 1 && day <= daysInMonth ? day : null;
    }),
  };
}

function shiftMonth(iso: string, delta: number) {
  const date = dateFromIso(iso);
  const shifted = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return toIso(shifted.getFullYear(), shifted.getMonth() + 1, 1);
}

function LogoMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`logo-mark ${small ? 'logo-mark-small' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" role="img">
        <path
          d="M12 29 31.5 14 52 29"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M47 25V17h6v13"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <rect
          x="18"
          y="29"
          width="29"
          height="24"
          rx="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          d="M24 27v7M40 27v7"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <rect x="24" y="38" width="6" height="6" rx="1.5" fill="currentColor" />
        <rect x="34" y="38" width="6" height="6" rx="1.5" fill="#2f9cf4" />
        <rect
          x="24"
          y="46"
          width="6"
          height="4"
          rx="1.5"
          fill="currentColor"
          opacity=".72"
        />
      </svg>
    </span>
  );
}


function CategoryPill({ name }: { name: CategoryName }) {
  const meta = CATEGORY_META[name];
  return (
    <span
      className="category-pill"
      style={{ color: meta.color, background: meta.soft }}
    >
      <i style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

function FeatureCard({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <article className="feature-card">
      <span>{icon}</span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
    </article>
  );
}

function renderPdfCanvas(day: PdfDay, fallbackIdentity: PdfPrintIdentity) {
  const identity = day.printIdentity || fallbackIdentity;
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1414;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1000, 1414);
  ctx.fillStyle = '#172330';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(identity.calendarTitle || 'Teamup Schedule', 54, 64, 610);
  if (identity.accountLabel) {
    ctx.font = '15px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(identity.accountLabel, 946, 62, 262);
    ctx.textAlign = 'left';
  }
  ctx.strokeStyle = '#d9e0e5';
  ctx.beginPath();
  ctx.moveTo(54, 84);
  ctx.lineTo(946, 84);
  ctx.stroke();
  ctx.fillStyle = '#253744';
  ctx.font = '700 18px Arial, sans-serif';
  ctx.fillText(fullDate(day.date), 70, 124);
  const top = 190;
  const bottom = 1300;
  const left = 142;
  const right = 930;
  const startHour = 8;
  const endHour = 20;
  const minuteHeight = (bottom - top) / ((endHour - startHour) * 60);
  for (let hour = startHour; hour <= endHour; hour += 1) {
    const y = top + (hour - startHour) * 60 * minuteHeight;
    ctx.strokeStyle = '#d7dde2';
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    if (hour < endHour) {
      ctx.fillStyle = '#53626e';
      ctx.font = '13px Arial, sans-serif';
      ctx.fillText(`${String(hour).padStart(2, '0')}:00`, 72, y + 4);
    }
  }
  day.events
    .filter(event => !event.allDay)
    .forEach(event => {
      const start = Math.max(event.start, startHour * 60);
      const end = Math.min(event.end, endHour * 60);
      if (end <= start) return;
      const y = top + (start - startHour * 60) * minuteHeight;
      const height = Math.max(30, (end - start) * minuteHeight);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#cbd5dc';
      ctx.fillRect(left, y + 1, right - left, height - 2);
      ctx.strokeRect(left, y + 1, right - left, height - 2);
      const category = event.categories[0] || 'Job Routine';
      ctx.fillStyle = CATEGORY_META[category].color;
      ctx.fillRect(left, y + 1, 7, height - 2);
      ctx.fillStyle = '#263844';
      ctx.font = '700 12px Arial, sans-serif';
      const label = `${formatTime(event.start)}  ${event.title}`;
      const maxChars = 105;
      ctx.fillText(
        label.length > maxChars ? `${label.slice(0, maxChars)}…` : label,
        left + 20,
        y + 20
      );
    });
  ctx.strokeStyle = '#d9e0e5';
  ctx.beginPath();
  ctx.moveTo(54, 1340);
  ctx.lineTo(946, 1340);
  ctx.stroke();
  const zone = identity.timeZone.split('/').pop()?.replace(/_/g, ' ') || '';
  ctx.textAlign = 'right';
  ctx.font = '14px Arial, sans-serif';
  ctx.fillStyle = '#1689aa';
  if (zone) ctx.fillText(zone, 742, 1376, 165);
  ctx.fillStyle = '#788792';
  ctx.fillText('Powered by', 842, 1376);
  ctx.fillStyle = '#30475a';
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      ctx.fillRect(851 + col * 7, 1357 + row * 7, 4, 4);
    }
  }
  ctx.font = '700 19px Arial, sans-serif';
  ctx.fillText('teamup', 946, 1377);
  return canvas;
}

async function makePdf(days: PdfDay[], identity: PdfPrintIdentity) {
  const document = await PDFDocument.create();
  for (const day of days) {
    const png = await document.embedPng(
      renderPdfCanvas(day, identity).toDataURL('image/png')
    );
    const page = document.addPage([595.28, 841.89]);
    page.drawImage(png, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return document.save();
}

async function downloadPdf(
  days: PdfDay[],
  filename: string,
  identity: PdfPrintIdentity
) {
  const bytes = await makePdf(days, identity);
  const url = URL.createObjectURL(
    new Blob([bytes], { type: 'application/pdf' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function printIdentityFromConnection(connection: Connection | null): PdfPrintIdentity {
  return {
    calendarTitle: connection?.calendarName?.trim() || 'Teamup Calendar',
    accountLabel: connection?.printName?.trim() || '',
    timeZone: 'Asia/Bangkok',
  };
}

async function resolvePrintIdentity(
  connection: Connection | null
): Promise<PdfPrintIdentity> {
  const fallback = printIdentityFromConnection(connection);
  if (!connection || connection.demo) return fallback;
  try {
    const response = await api.post('/api/teamup/discover', {
      connection: {
        apiKey: connection.apiKey,
        calendarKey: connection.calendarKey,
      },
    });
    const data = response.data as {
      calendarName?: string;
      viewerName?: string;
      viewerEmail?: string;
      linkName?: string;
      timeZone?: string;
    };
    return {
      calendarTitle: data.calendarName?.trim() || fallback.calendarTitle,
      accountLabel:
        connection.printName?.trim() ||
        data.viewerName?.trim() ||
        data.viewerEmail?.trim() ||
        data.linkName?.trim() ||
        fallback.accountLabel,
      timeZone: data.timeZone?.trim() || fallback.timeZone,
    };
  } catch {
    return fallback;
  }
}


type AiResult = Record<string, unknown> & { pending?: boolean; jobId?: string; token?: string };
async function requestAiLocalFirst<T extends object>(route: string, payload: Record<string, unknown>): Promise<T> {
  const first = await api.post(route, payload);
  const initial = first.data as AiResult;
  if (!initial.pending) return initial as T;
  if (!initial.jobId || !initial.token) throw new Error('Local AI returned an invalid job reference.');
  try {
    for (let attempt = 0; attempt < 72; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 1700));
      const poll = await api.post('/api/ai/job-status', { jobId: initial.jobId, token: initial.token });
      const status = poll.data as { status?: string; result?: T };
      if (status.status === 'completed' && status.result) return status.result;
      if (status.status === 'failed') throw new Error('Local AI could not complete the request.');
    }
    throw new Error('Local AI job timed out.');
  } catch (localFailure) {
    console.warn('Local AI worker unavailable; using AppDeploy AI backup.', localFailure);
    const backup = await api.post(route, { ...payload, forceAppDeploy: true });
    return backup.data as T;
  }
}

function PublicApp() {
  const [view, setView] = useState<ViewName>('landing');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [input, setInput] = useState('');
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [calendarReference, setCalendarReference] = useState(bangkokTodayIso());
  const [calendarEvents, setCalendarEvents] = useState<TeamupEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [localOnline, setLocalOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const stored =
      localStorage.getItem(CONNECTION_KEY) ||
      sessionStorage.getItem(CONNECTION_KEY);
    if (!stored) return;
    try {
      setConnection(JSON.parse(stored) as Connection);
    } catch {
      localStorage.removeItem(CONNECTION_KEY);
      sessionStorage.removeItem(CONNECTION_KEY);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void api.get('/api/local-ai/status').then(response => setLocalOnline(Boolean((response.data as { localOnline?: boolean }).localOnline))).catch(() => setLocalOnline(false));
  }, []);

  const connected = Boolean(connection);

  function navigate(next: ViewName) {
    if (
      ['schedule', 'calendar', 'attendance', 'pdf', 'settings'].includes(next) &&
      !connection
    ) {
      setView('setup');
      return;
    }
    setView(next);
  }

  function saveConnection(next: Connection) {
    setConnection(next);
    sessionStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
    if (next.remembered)
      localStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
    else localStorage.removeItem(CONNECTION_KEY);
    setView('schedule');
    setToast({
      tone: 'ok',
      text: next.demo ? 'Demo mode พร้อมใช้งาน' : 'เชื่อมต่อ Teamup เรียบร้อย',
    });
  }

  function updatePrintName(value: string) {
    if (!connection) return;
    const next = { ...connection, printName: value.slice(0, 120) };
    setConnection(next);
    sessionStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
    if (next.remembered)
      localStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
    else localStorage.removeItem(CONNECTION_KEY);
  }

  function disconnect() {
    localStorage.removeItem(CONNECTION_KEY);
    sessionStorage.removeItem(CONNECTION_KEY);
    setConnection(null);
    setCalendarEvents([]);
    setEvents([]);
    setAttendanceRows([]);
    setSubmitted(false);
    setView('landing');
    setToast({ tone: 'ok', text: 'ตัดการเชื่อมต่อจากอุปกรณ์นี้แล้ว' });
  }

  async function generateSchedule() {
    if (generating) return;
    const parsed = parseSchedule(input, attendanceRows);
    if (!parsed.events.length) {
      setToast({ tone: 'warn', text: parsed.message || 'ไม่พบงานที่สร้างได้' });
      return;
    }
    setGenerating(true);
    setSubmitted(false);
    try {
      const sources = Array.from(new Set(parsed.events.map(event => event.source).filter(Boolean)));
      let translations = new Map<string, string>();
      try {
        const result = await requestAiLocalFirst<{ titles?: string[] }>('/api/translate-work-lines', { lines: sources });
        const titles = Array.isArray(result.titles) ? result.titles : [];
        translations = new Map(sources.map((source, index) => [source, titles[index] || '']));
      } catch (caught) {
        console.warn('AI translation unavailable; using deterministic titles.', caught);
        setToast({ tone: 'warn', text: 'AI แปลภาษาไม่พร้อม ใช้คำแปลสำรองที่ไม่เพิ่มข้อมูลเอง' });
      }
      setEvents(parsed.events.map(event => ({ ...event, title: translations.get(event.source) || event.title })));
      setCalendarReference(parsed.events[0].date);
      setToast({ tone: 'ok', text: 'สร้าง ' + parsed.events.length + ' Event แล้ว ตรวจ Preview ก่อนส่ง Teamup' });
    } finally {
      setGenerating(false);
    }
  }

  function toggleEventCategory(id: string, category: CategoryName) {
    setSubmitted(false);
    setEvents(current => current.map(event => {
      if (event.id !== id) return event;
      const picked = event.categories.includes(category)
        ? event.categories.filter(name => name !== category)
        : [...event.categories, category];
      return { ...event, categories: picked.length ? picked : ['Job Routine'] };
    }));
  }

  async function submitEvents() {
    if (submitting || submitted) return;
    if (!connection || connection.demo || !events.length) {
      setToast({
        tone: 'warn',
        text: connection?.demo
          ? 'Demo mode จะไม่เขียนข้อมูลเข้า Teamup จริง'
          : 'ยังไม่มี Event ให้ส่ง',
      });
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post('/api/teamup/events', {
        connection: {
          apiKey: connection.apiKey,
          calendarKey: connection.calendarKey,
        },
        mapping: connection.mapping,
        events: events.map(({ date, start, end, title, categories }) => ({
          date,
          start,
          end,
          title,
          categories,
        })),
      });
      const created = Number(
        (response.data as { created?: number }).created || events.length
      );
      setSubmitted(true);
      setToast({ tone: 'ok', text: `เพิ่ม ${created} Event เข้า Teamup แล้ว` });
    } catch {
      setToast({
        tone: 'error',
        text: 'ส่งเข้า Teamup ไม่สำเร็จ ตรวจ Connection แล้วลองอีกครั้ง',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function syncCalendar(reference = calendarReference) {
    if (!connection) return;
    if (connection.demo) {
      const month = reference.slice(0, 7);
      setCalendarEvents([
        {
          id: 'demo-1',
          date: `${month}-05`,
          start: 9 * 60 + 30,
          end: 12 * 60,
          title: 'Site Inspection - Sample Project',
          categories: ['Outside', 'Follow Up'],
        },
        {
          id: 'demo-2',
          date: `${month}-12`,
          start: 13 * 60,
          end: 16 * 60,
          title: 'Drawing - Sample Project',
          categories: ['Job Routine'],
        },
      ]);
      return;
    }
    setCalendarLoading(true);
    try {
      const response = await api.post('/api/teamup/month-events', {
        connection: {
          apiKey: connection.apiKey,
          calendarKey: connection.calendarKey,
        },
        mapping: connection.mapping,
        month: reference.slice(0, 7),
      });
      setCalendarEvents(
        (response.data as { events?: TeamupEvent[] }).events || []
      );
    } catch {
      setCalendarEvents([]);
      setToast({ tone: 'error', text: 'ดึง Calendar จาก Teamup ไม่สำเร็จ' });
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => {
    if (view === 'calendar' && connection) void syncCalendar(calendarReference);
  }, [view, calendarReference, connection]);

  const calendarModel = buildCalendar(calendarReference);
  const eventsByDate = useMemo(() => {
    const map = new Map<string, TeamupEvent[]>();
    calendarEvents.forEach(event =>
      map.set(event.date, [...(map.get(event.date) || []), event])
    );
    return map;
  }, [calendarEvents]);

  const navItems: Array<{ id: ViewName; label: string; icon: ReactNode }> = [
    { id: 'schedule', label: 'Home', icon: <Home size={18} /> },
    { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={18} /> },
    { id: 'pdf', label: 'PDF Export', icon: <Printer size={18} /> },
    { id: 'attendance', label: 'Attendance', icon: <ClipboardList size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];


  if (view === 'landing') {
    return (
      <Landing
        onStart={() => setView(connection ? 'schedule' : 'setup')}
        onGuide={() => setView('guide')}
      />
    );
  }

  if (view === 'setup') {
    return (
      <Setup
        current={connection}
        onSave={saveConnection}
        onBack={() => setView('landing')}
        onDemo={() =>
          saveConnection({
            apiKey: '',
            calendarKey: '',
            mapping: {
              Outside: 1,
              'Follow Up': 2,
              'Job Routine': 3,
              Meeting: 4,
              Leave: 5,
            },
            calendarName: 'Demo Calendar',
            remembered: false,
            demo: true,
          })
        }
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <LogoMark />
          <div><b>BURANADEE</b><span>Teamup Assistant</span></div>
        </div>
        <nav>
          {navItems.map(item => (
            <button key={item.id} className={'nav-button ' + (view === item.id ? 'active' : '')} onClick={() => navigate(item.id)}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button type="button" className={'connection-card ' + (connection?.demo ? 'attention' : connected ? 'connected' : 'offline')} onClick={() => setView('settings')}>
          <span className={'status-dot ' + (connected ? 'connected' : 'offline')} />
          <b>{connection?.demo ? 'Demo Mode' : connected ? 'Teamup Connected' : 'Teamup Not Connected'}</b>
          <p>{connection?.calendarName || 'Connect your own Teamup calendar in Settings.'}</p>
        </button>
        <div className="sidebar-foot">Built for Architects<br />by Buranadee</div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><LogoMark small /><b>BURANADEE</b></div>
          <div className="top-title">
            <span>{view === 'schedule' ? 'Schedule' : view === 'calendar' ? 'Calendar' : view === 'pdf' ? 'PDF Export' : view === 'attendance' ? 'Attendance' : view === 'settings' ? 'Settings' : 'Guide'}</span>
            <small>Teamup backfill, without the busywork.</small>
          </div>
          <button type="button" className="profile-chip" onClick={() => setView('settings')}>
            <span className="avatar">{(connection?.printName || connection?.calendarName || 'G').charAt(0).toUpperCase()}</span>
            <span>{connection?.demo ? 'Demo User' : connection?.printName || connection?.calendarName || 'Public User'}</span>
            <Menu size={17} />
          </button>
        </header>
        {view === 'schedule' && (
          <ScheduleView
            input={input}
            setInput={value => { setInput(value); setSubmitted(false); }}
            events={events}
            attendanceRows={attendanceRows}
            onGenerate={() => void generateSchedule()}
            onSubmit={() => void submitEvents()}
            onToggleCategory={toggleEventCategory}
            onOpenAttendance={() => setView('attendance')}
            demo={Boolean(connection?.demo)}
            generating={generating}
            submitting={submitting}
            submitted={submitted}
          />
        )}
        {view === 'calendar' && (
          <CalendarView model={calendarModel} eventsByDate={eventsByDate} loading={calendarLoading}
            selectedDate={selectedDate} setSelectedDate={setSelectedDate}
            onPrev={() => setCalendarReference(current => shiftMonth(current, -1))}
            onNext={() => setCalendarReference(current => shiftMonth(current, 1))}
            onToday={() => setCalendarReference(bangkokTodayIso())}
            onSync={() => void syncCalendar()}
          />
        )}
        {view === 'attendance' && <AttendanceView rows={attendanceRows} setRows={setAttendanceRows} onUse={() => setView('schedule')} notify={setToast} />}
        {view === 'pdf' && <PdfView connection={connection} notify={setToast} onPrintNameChange={updatePrintName} />}
        {view === 'settings' && (
          <PublicSettings connection={connection} localOnline={localOnline} onConfigure={() => setView('setup')}
            onGuide={() => setView('guide')} onDisconnect={disconnect} />
        )}
        {view === 'guide' && <GuideView onStart={() => setView(connection ? 'schedule' : 'setup')} />}
        {toast && <div className={'toast ' + toast.tone}><span>{toast.text}</span><button onClick={() => setToast(null)}><X size={16} /></button></div>}
      </main>
      <nav className="mobile-nav">
        {navItems.map(item => (
          <button key={item.id} className={'nav-button ' + (view === item.id ? 'active' : '')} onClick={() => navigate(item.id)}>
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );

}

function Landing({
  onStart,
  onGuide,
}: {
  onStart: () => void;
  onGuide: () => void;
}) {
  const features = [
    [
      <Sparkles size={21} />,
      'Quick Input ภาษาไทย',
      'พิมพ์งานแบบธรรมชาติ แล้วเปลี่ยนเป็น Event ภาษาอังกฤษ',
    ],
    [
      <ClipboardList size={21} />,
      'Attendance OCR',
      'อ่านเวลาเข้าออกจากภาพ Attendance แล้วใช้สร้างตารางงาน',
    ],
    [
      <CalendarDays size={21} />,
      'Calendar Sync',
      'เห็น Event จาก Teamup ในปฏิทินรายเดือน',
    ],
    [
      <Printer size={21} />,
      'PDF Export & Merge',
      'สร้าง PDF หลายรอบ เก็บ Queue และรวมภายหลัง',
    ],
  ] as const;
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <button className="brand-lockup">
          <LogoMark />
          <span>
            <b>BURANADEE</b>
            <small>Teamup Assistant</small>
          </span>
        </button>
        <div>
          <button onClick={onGuide}>คู่มือ</button>
          <button className="primary" onClick={onStart}>
            เริ่มใช้งาน <ArrowRight size={16} />
          </button>
        </div>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <span className="edition-pill">PUBLIC EDITION</span>
          <h1>
            จากโน้ตงาน
            <br />
            ไปสู่ Teamup <em>แบบเป็นระบบ</em>
          </h1>
          <p>
            ช่วยจัดตารางงานย้อนหลัง แปลรายละเอียดไทยเป็น English Event
            จัดหมวดหมู่ Sync Calendar และ Export PDF ในเครื่องมือเดียว
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={onStart}>
              เริ่มใช้งานฟรี <ArrowRight size={17} />
            </button>
            <button className="secondary" onClick={onGuide}>
              <BookOpen size={17} /> ดูคู่มือก่อน
            </button>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={16} />
            <span>
              Teamup key ของผู้ใช้ไม่ถูกฝังในเว็บ
              และเลือกได้ว่าจะจำไว้บนอุปกรณ์นี้หรือไม่
            </span>
          </div>
        </div>
        <div className="hero-mock">
          <div className="mock-window">
            <span className="mock-title">Today</span>
            <article>
              <i className="orange" />
              <b>09:30</b>
              <span>Site Inspection</span>
            </article>
            <article>
              <i className="blue" />
              <b>13:00</b>
              <span>Drawing Revision</span>
            </article>
            <article>
              <i className="green" />
              <b>16:00</b>
              <span>Meeting</span>
            </article>
          </div>
          <div className="mock-badge">
            <Sparkles size={20} />
            <b>Thai → English</b>
            <small>Auto category + color</small>
          </div>
        </div>
      </section>
      <section className="landing-features">
        <div className="section-kicker">FEATURES</div>
        <h2>งานที่เคยทำซ้ำ ให้เหลือไม่กี่ขั้นตอน</h2>
        <div className="feature-grid">
          {features.map(([icon, title, text]) => (
            <FeatureCard key={title} icon={icon} title={title} text={text} />
          ))}
        </div>
      </section>
      <section className="workflow-strip">
        <div>
          <span>1</span>
          <b>Connect Teamup</b>
          <small>ใส่ API Key + Calendar Link</small>
        </div>
        <ArrowRight />
        <div>
          <span>2</span>
          <b>Add work notes</b>
          <small>ไทยได้ ไม่ต้องใช้ format ซับซ้อน</small>
        </div>
        <ArrowRight />
        <div>
          <span>3</span>
          <b>Generate</b>
          <small>แปล + จัด Event อัตโนมัติ</small>
        </div>
        <ArrowRight />
        <div>
          <span>4</span>
          <b>Review</b>
          <small>ตรวจเวลา หมวดหมู่ และ Preview</small>
        </div>
        <ArrowRight />
        <div>
          <span>5</span>
          <b>Teamup / PDF</b>
          <small>ส่งจริงหรือเก็บเป็นเอกสาร</small>
        </div>
      </section>
      <section className="landing-cta">
        <div>
          <span className="edition-pill">READY WHEN YOU ARE</span>
          <h2>เริ่มจาก Demo ได้ โดยยังไม่ต้องเชื่อม Teamup</h2>
          <p>ลอง workflow ก่อน แล้วค่อยเชื่อมปฏิทินของตัวเองเมื่อพร้อม</p>
        </div>
        <button className="primary" onClick={onStart}>
          เปิด Public Edition <ArrowRight size={17} />
        </button>
      </section>
      <footer className="landing-footer">
        BURANADEE • Simple tools for a more organized tomorrow.
      </footer>
    </div>
  );
}

function Setup({
  current,
  onSave,
  onBack,
  onDemo,
}: {
  current: Connection | null;
  onSave: (connection: Connection) => void;
  onBack: () => void;
  onDemo: () => void;
}) {
  const [apiKey, setApiKey] = useState(
    current?.demo ? '' : current?.apiKey || ''
  );
  const [calendarKey, setCalendarKey] = useState(
    current?.demo ? '' : current?.calendarKey || ''
  );
  const [remembered, setRemembered] = useState(current?.remembered ?? false);
  const [subcalendars, setSubcalendars] = useState<Subcalendar[]>([]);
  const [mapping, setMapping] = useState<Mapping>(
    current?.mapping || {
      Outside: 0,
      'Follow Up': 0,
      'Job Routine': 0,
      Meeting: 0,
      Leave: 0,
    }
  );
  const [calendarName, setCalendarName] = useState(current?.calendarName || '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function discover() {
    if (!apiKey.trim() || !calendarKey.trim()) {
      setMessage('ใส่ API Key และ Calendar Link / Key ให้ครบ');
      return;
    }
    setLoading(true);
    setMessage('กำลังตรวจสอบ Teamup…');
    try {
      const response = await api.post('/api/teamup/discover', {
        connection: { apiKey: apiKey.trim(), calendarKey: calendarKey.trim() },
      });
      const payload = response.data as {
        calendarName?: string;
        subcalendars?: Subcalendar[];
      };
      const list = payload.subcalendars || [];
      setSubcalendars(list);
      setMapping(bestGuessMapping(list));
      setCalendarName(payload.calendarName || 'Teamup Calendar');
      setMessage(
        `เชื่อมต่อแล้ว พบ ${list.length} sub-calendars • ตรวจ Mapping ด้านล่าง`
      );
    } catch {
      setSubcalendars([]);
      setMessage(
        'เชื่อมต่อไม่สำเร็จ ตรวจ API Key และ Calendar Link แล้วลองใหม่'
      );
    } finally {
      setLoading(false);
    }
  }

  const complete = CATEGORIES.every(category => Number(mapping[category]) > 0);
  return (
    <div className="setup-page">
      <div className="setup-card">
        <button className="back-link" onClick={onBack}>
          <ChevronLeft size={16} /> กลับหน้าแรก
        </button>
        <div className="setup-head">
          <LogoMark />
          <div>
            <span>PUBLIC EDITION</span>
            <h1>เชื่อม Teamup ของคุณ</h1>
            <p>
              ตั้งค่าครั้งแรกประมาณ 2 นาที แล้วระบบจะใช้ Calendar ของคุณโดยตรง
            </p>
          </div>
        </div>
        <div className="setup-note">
          <ShieldCheck size={18} />
          <div>
            <b>Credential ownership</b>
            <span>
              Key ถูกส่งไปใช้กับ Teamup ตอนทำรายการเท่านั้น ระบบนี้ไม่มี Teamup
              Key กลางสำหรับผู้ใช้ทั่วไป ถ้าไม่เลือก “จำบนอุปกรณ์นี้”
              ค่าเชื่อมต่อจะอยู่เฉพาะ session นี้
            </span>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>Teamup API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              placeholder="API key จาก Teamup"
            />
          </label>
          <label>
            <span>Calendar Link หรือ ks… key</span>
            <input
              value={calendarKey}
              onChange={event => setCalendarKey(event.target.value)}
              placeholder="https://teamup.com/ks… หรือ ks…"
            />
          </label>
        </div>
        <label className="remember-row">
          <input
            type="checkbox"
            checked={remembered}
            onChange={event => setRemembered(event.target.checked)}
          />
          <span>จำการเชื่อมต่อไว้บนอุปกรณ์นี้</span>
        </label>
        <button
          className="primary wide"
          disabled={loading}
          onClick={() => void discover()}
        >
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Link2 size={17} />
          )}
          {loading ? 'Checking…' : 'Check Connection'}
        </button>
        {message && (
          <div className={`setup-message ${subcalendars.length ? 'ok' : ''}`}>
            {message}
          </div>
        )}
        {subcalendars.length > 0 && (
          <div className="mapping-box">
            <div className="mapping-head">
              <b>Category Mapping</b>
              <span>เลือก Teamup sub-calendar ให้ครบ 5 หมวด</span>
            </div>
            {CATEGORIES.map(category => (
              <label key={category}>
                <span>
                  <i style={{ background: CATEGORY_META[category].color }} />
                  {CATEGORY_META[category].label}
                </span>
                <select
                  value={mapping[category]}
                  onChange={event =>
                    setMapping(currentMap => ({
                      ...currentMap,
                      [category]: Number(event.target.value),
                    }))
                  }
                >
                  <option value={0}>เลือก sub-calendar</option>
                  {subcalendars.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {subcalendars.length > 0 && (
          <button
            className="primary wide"
            disabled={!complete}
            onClick={() =>
              onSave({
                apiKey: apiKey.trim(),
                calendarKey: calendarKey.trim(),
                mapping,
                calendarName,
                remembered,
              })
            }
          >
            <Check size={17} /> Save & Start
          </button>
        )}
        <div className="demo-divider">
          <span>หรือ</span>
        </div>
        <button className="secondary wide" onClick={onDemo}>
          <Sparkles size={17} /> Try Demo without Teamup
        </button>
        <div className="setup-help">
          <CircleHelp size={17} />
          <span>
            ต้องมี Teamup API Key และ Calendar link ที่มีสิทธิ์อ่าน/สร้าง Event
            หากชื่อหมวดของคุณต่างจากตัวอย่าง ให้เลือก Mapping เองได้
          </span>
        </div>
      </div>
    </div>
  );
}

function ScheduleView({
  input, setInput, events, attendanceRows, onGenerate, onSubmit,
  onToggleCategory, onOpenAttendance, demo, generating, submitting, submitted,
}: {
  input: string;
  setInput: (value: string) => void;
  events: WorkEvent[];
  attendanceRows: AttendanceRow[];
  onGenerate: () => void;
  onSubmit: () => void;
  onToggleCategory: (id: string, category: CategoryName) => void;
  onOpenAttendance: () => void;
  demo: boolean;
  generating: boolean;
  submitting: boolean;
  submitted: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const totalHours = events.reduce((sum, event) => sum + Math.max(0, event.end - event.start) / 60, 0);
  const dates = Array.from(new Set(events.map(event => event.date))).sort();
  const snippets: Record<CategoryName, string> = {
    Outside: '09.00-12.00 ไปตรวจหน้างานโครงการตัวอย่าง',
    'Job Routine': '13.00-15.00 เขียนแบบโครงการตัวอย่าง',
    Meeting: '15.00-16.00 ประชุมประสานงานโครงการ',
    'Follow Up': '16.00-17.00 ติดตามงานผู้รับเหมา',
    Leave: '09.00-18.00 ลาพักร้อน',
  };
  return (
    <section className="workspace home-workspace">
      <div className="panel input-panel">
        <div className="panel-heading">
          <div><h2>Add Schedule</h2><p>Type naturally in Thai. Output is English.</p></div>
          <Sparkles size={20} />
        </div>
        <div className="mode-tabs">
          <button className="selected">Quick Input</button>
          <button onClick={onOpenAttendance}>From Attendance</button>
          <button onClick={() => setInput(SAMPLE_INPUT)}>Templates</button>
        </div>
        <textarea
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder={'17,21,22,27/SEP\n09.30-15.00 ไปหน้างานตรวจงาน...\n15.00-18.30 เคลียร์แบบ...'}
        />
        <div className="helper-row">
          Dates: 20,21,23-24/JUL or /07 • Mixed dates + ranges supported • With Attendance loaded, work lines can omit times • “คุณ” becomes “Khun”
          {attendanceRows.length > 0 && <b> • Attendance ready ({attendanceRows.length} days)</b>}
        </div>
        <div className="input-actions">
          <button className="secondary" onClick={() => setInput(SAMPLE_INPUT)}><Copy size={16} /> Example</button>
          <button className="primary" disabled={generating} onClick={onGenerate}>
            {generating ? <><LoaderCircle className="spin" size={17} /> Translating...</> : <><Sparkles size={17} /> Generate Schedule</>}
          </button>
        </div>
        <div className="quick-grid">
          {CATEGORIES.map(category => (
            <button key={category} style={{ '--quick': CATEGORY_META[category].color } as React.CSSProperties}
              onClick={() => setInput(input + (input.trim() ? '\n' : '') + snippets[category])}
              title={'Insert ' + CATEGORY_META[category].label + ' example'}>
              <span />{CATEGORY_META[category].label.split(' / ')[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="panel preview-panel">
        <div className="panel-heading">
          <div><h2>Preview Events</h2><p>{events.length ? dates.length + ' days • ' + friendlyDate(dates[0]) + ' - ' + friendlyDate(dates[dates.length-1]) : 'Dates will follow Quick Input'}</p></div>
          <span className="count-badge">{events.length} events</span>
        </div>
        {events.length === 0 ? (
          <div className="big-empty"><LogoMark /><h3>No events yet</h3><p>Enter your work notes, then generate a clean Teamup timeline.</p></div>
        ) : (
          <div className="event-list">
            {events.map(event => (
              <article key={event.id} className="event-card" style={{ borderLeftColor: CATEGORY_META[event.categories[0]].color }}>
                <div className="event-time"><em>{friendlyDate(event.date)}</em><b>{formatTime(event.start)}</b><span>{formatTime(event.end)}</span></div>
                <div className="event-body">
                  <h3>{event.title}</h3>
                  <div className="pill-row">{event.categories.map(category => <CategoryPill key={category} name={category} />)}</div>
                  <small>Original: {event.source}</small>
                </div>
                <button className="edit-button" onClick={() => setEditingId(editingId === event.id ? null : event.id)} aria-label="Edit event categories"><Copy size={15} /></button>
                {editingId === event.id && (
                  <div className="category-editor">
                    <b>Manual override</b>
                    {CATEGORIES.map(category => {
                      const checked = event.categories.includes(category);
                      return <button className={checked ? 'picked' : ''} key={category} onClick={() => onToggleCategory(event.id, category)}>
                        {checked ? <Check size={14} /> : <span className="empty-check" />}
                        {CATEGORY_META[category].label}
                      </button>;
                    })}
                  </div>
                )}
              </article>
            ))}
            <div className="lunch-card"><Clock3 size={18} /><div><b>12:00-13:00 Lunch Break</b><span>Locked for work events. Leave may continue through this hour.</span></div></div>
          </div>
        )}
        <div className="preview-footer">
          <span>{totalHours.toFixed(1)} work hours in preview</span>
          <button className="primary" disabled={!events.length || submitting || submitted || demo} onClick={onSubmit}>
            {submitting ? <><LoaderCircle className="spin" size={16} /> Adding to Teamup...</> : submitted ? <><Check size={16} /> Added to Teamup</> : demo ? 'Preview Complete' : 'Add ' + (events.length || '') + ' Events to Teamup'}
          </button>
        </div>
      </div>
      <div className="panel day-panel">
        <div className="panel-heading"><div><h2>Day Preview</h2><p>Protected lunch break included.</p></div></div>
        {events.length ? (
          <div className="timeline compact">
            {dates.map(date => (
              <div key={date} className="timeline-day">
                <div className="timeline-date-label">{fullDate(date)}</div>
                {events.filter(event => event.date === date).map(event => (
                  <div className="timeline-row" key={event.id}>
                    <div className="timeline-time">{formatTime(event.start)}<span>{formatTime(event.end)}</span></div>
                    <div className="timeline-bar" style={{ borderLeftColor: CATEGORY_META[event.categories[0]].color }}>
                      <strong>{event.title}</strong>
                      <div className="tiny-pills">{event.categories.map(category => <CategoryPill key={category} name={category} />)}</div>
                    </div>
                  </div>
                ))}
                <div className="timeline-row lunch-row">
                  <div className="timeline-time">12:00<span>13:00</span></div>
                  <div className="lunch-lock"><Clock3 size={15} /> Lunch Break (Auto)<span>Locked</span></div>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state"><Clock3 size={28} /><span>Generate Schedule to see Day Preview</span></div>}
      </div>
    </section>
  );
}

function CalendarView({
  model, eventsByDate, loading, selectedDate, setSelectedDate, onPrev, onNext, onToday, onSync,
}: {
  model: ReturnType<typeof buildCalendar>;
  eventsByDate: Map<string, TeamupEvent[]>;
  loading: boolean;
  selectedDate: string | null;
  setSelectedDate: (value: string | null) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSync: () => void;
}) {
  const selectedEvents = selectedDate ? eventsByDate.get(selectedDate) || [] : [];
  const monthEvents = Array.from(eventsByDate.values()).flat();
  return (
    <section className="workspace single-workspace">
      <div className="panel calendar-panel">
        <div className="calendar-toolbar">
          <div><h2>{model.label}</h2><p>{loading ? 'Syncing Teamup...' : 'Synced from Teamup • ' + monthEvents.length + ' events'}</p></div>
          <div className="calendar-actions">
            <button className="sync-month" disabled={loading} onClick={onSync}>
              {loading ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />}<span>Sync Teamup</span>
            </button>
            <button aria-label="Previous month" onClick={onPrev}><ChevronLeft size={17} /></button>
            <button className="today" onClick={onToday}>Today</button>
            <button aria-label="Next month" onClick={onNext}><ChevronRight size={17} /></button>
          </div>
        </div>
        <div className="calendar-grid">
          {['MON','TUE','WED','THU','FRI','SAT','SUN'].map(day => <b key={day}>{day}</b>)}
          {model.cells.map((day,index) => {
            const iso = day ? toIso(model.year,model.month + 1,day) : '';
            const list = iso ? eventsByDate.get(iso) || [] : [];
            return (
              <button key={index} className={(list.length ? 'calendar-has-events ' : '') + (selectedDate===iso && iso ? 'calendar-selected' : '')} onClick={() => { if (iso) setSelectedDate(iso); }}>
                {day || ''}
                {list.length > 0 && <span className="mini-dots">{Array.from(new Set(list.flatMap(event => event.categories))).map(category => <i key={category} style={{background:CATEGORY_META[category].color}} />)}</span>}
              </button>
            );
          })}
        </div>
        <div className="calendar-detail">
          <div><h3>{selectedDate ? fullDate(selectedDate) : model.label}</h3><p>{selectedDate ? selectedEvents.length : monthEvents.length} Teamup events</p></div>
          <div>
            {loading && !monthEvents.length ? <div className="calendar-sync-message"><LoaderCircle className="spin" size={16} /> Syncing...</div>
              : selectedEvents.length ? (
                <div className="synced-event-list">
                  {selectedEvents.map(event => (
                    <article className="synced-event-row" key={event.id}>
                      <div className="synced-event-time">{event.allDay ? 'All day' : <><b>{formatTime(event.start)}</b><span>{formatTime(event.end)}</span></>}</div>
                      <div className="synced-event-body" style={{borderLeftColor:CATEGORY_META[event.categories[0] || 'Job Routine'].color}}>
                        <strong>{event.title}</strong>
                        <div className="tiny-pills">{event.categories.map(category => <CategoryPill key={category} name={category} />)}</div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="calendar-empty-day">No Teamup events on this date.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function AttendanceView({
  rows,
  setRows,
  onUse,
  notify,
}: {
  rows: AttendanceRow[];
  setRows: (rows: AttendanceRow[]) => void;
  onUse: () => void;
  notify: (toast: Toast) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function processPrepared(
    data: string,
    mimeType: string,
    previewUrl?: string
  ) {
    setLoading(true);
    if (previewUrl) setPreview(previewUrl);
    try {
      const payload = await requestAiLocalFirst<{ records?: AttendanceRow[] }>('/api/attendance/ocr', {
        image: { data, mimeType },
      });
      const next = payload.records || [];
      if (!next.length) throw new Error('No dated scanner rows detected.');
      setRows(next);
      notify({ tone: 'ok', text: 'Read ' + next.length + ' attendance rows. Review before using them.' });
    } catch (caught) {
      console.warn('Attendance OCR failed', caught);
      notify({ tone: 'error', text: 'OCR ไม่สำเร็จ: Local AI หรือ AppDeploy สำรองอ่านตารางไม่ได้ กรุณาลองใหม่' });
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const prepared = await image.resizeIfNeeded(file, {
      maxDimension: 1600,
      maxPixels: 2000000,
      quality: 0.88,
      mimeType: 'image/jpeg',
    });
    await processPrepared(
      prepared.data,
      prepared.mimeType,
      URL.createObjectURL(file)
    );
  }

  async function trySample() {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 900, 360);
    ctx.fillStyle = '#111';
    ctx.font = '26px Arial';
    ctx.fillText('Attendance Scanner Times', 40, 55);
    ctx.font = '22px Arial';
    ctx.fillText('03 Sep 2026     09:15 18:20', 40, 120);
    ctx.fillText('04 Sep 2026     09:42 19:05', 40, 175);
    ctx.fillText('07 Sep 2026     08:58 18:10', 40, 230);
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    );
    if (!blob) return;
    const prepared = await image.resizeIfNeeded(blob, {
      maxDimension: 1600,
      maxPixels: 2000000,
      mimeType: 'image/jpeg',
    });
    await processPrepared(
      prepared.data,
      prepared.mimeType,
      canvas.toDataURL('image/jpeg')
    );
  }

  return (
    <section className="workspace attendance-workspace">
      <div className="panel upload-panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance Backfill</h2>
            <p>Scanner time is the source of truth.</p>
          </div>
          <ImagePlus size={20} />
        </div>
        <label className="upload-box">
          {preview ? (
            <img src={preview} alt="Attendance preview" />
          ) : (
            <>
              <Upload size={30} />
              <b>Upload attendance screenshot</b>
              <span>Image only • Scanner times are read automatically</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={event => void handleFile(event.target.files?.[0])}
          />
        </label>
        <button
          className="secondary wide"
          disabled={loading}
          onClick={() => void trySample()}
        >
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Sparkles size={17} />
          )}
          {loading ? 'Reading…' : 'Try Sample Scan'}
        </button>
      </div>
      <div className="panel attendance-table-panel">
        <div className="panel-heading">
          <div>
            <h2>Scanner Records</h2>
            <p>Use “เวลาจากเครื่องสแกน” only • Verify before applying</p>
          </div>
          <span className="count-badge">{rows.length} days</span>
        </div>
        {rows.length ? (
          <>
            <div className="attendance-table">
              <div className="attendance-head">
                <b>Date</b>
                <b>Check-in</b>
                <b>Check-out</b>
                <b>Note</b>
              </div>
              {rows.map(row => (
                <div className="attendance-line" key={row.date}>
                  <span>{friendlyDate(row.date)}</span>
                  <b>{row.checkIn}</b>
                  <b>{row.checkOut}</b>
                  <span>{row.note || '—'}</span>
                </div>
              ))}
            </div>
            <button className="primary wide" onClick={onUse}>
              <ArrowRight size={17} /> Use Attendance in Schedule
            </button>
          </>
        ) : (
          <div className="empty-state">
            <ClipboardList size={28} />
            <b>ยังไม่มีข้อมูล Attendance</b>
            <span>อัปโหลดภาพจริง หรือกด Try Sample Scan</span>
          </div>
        )}
      </div>
    </section>
  );
}

function PdfView({
  connection,
  notify,
  onPrintNameChange,
}: {
  connection: Connection | null;
  notify: (toast: Toast) => void;
  onPrintNameChange: (value: string) => void;
}) {
  const today = bangkokTodayIso();
  const [command, setCommand] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<PdfJob[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PDF_QUEUE_KEY);
      if (stored) setJobs(JSON.parse(stored) as PdfJob[]);
    } catch {
      localStorage.removeItem(PDF_QUEUE_KEY);
    }
  }, []);
  function persist(next: PdfJob[]) {
    setJobs(next);
    localStorage.setItem(PDF_QUEUE_KEY, JSON.stringify(next.slice(0, 20)));
  }

  function readCommand() {
    const parsed = parseNaturalRange(command);
    if ('error' in parsed) {
      notify({ tone: 'warn', text: parsed.error });
      return;
    }
    setFromDate(parsed.start);
    setToDate(parsed.end);
    notify({
      tone: 'ok',
      text: `อ่านช่วงวันที่แล้ว: ${friendlyDate(parsed.start)} → ${friendlyDate(parsed.end)}`,
    });
  }

  async function loadEvents(start: string, end: string) {
    if (!connection) return [] as TeamupEvent[];
    if (connection.demo)
      return [
        {
          id: 'pdf-demo-1',
          date: start,
          start: 9 * 60,
          end: 11 * 60,
          title: 'Site Inspection - Sample Project',
          categories: ['Outside'],
        },
        {
          id: 'pdf-demo-2',
          date: end,
          start: 13 * 60,
          end: 16 * 60,
          title: 'Drawing - Sample Project',
          categories: ['Job Routine'],
        },
      ];
    const responses = await Promise.all(
      monthKeysBetween(start, end).map(month =>
        api.post('/api/teamup/month-events', {
          connection: {
            apiKey: connection.apiKey,
            calendarKey: connection.calendarKey,
          },
          mapping: connection.mapping,
          month,
        })
      )
    );
    return responses
      .flatMap(
        response => (response.data as { events?: TeamupEvent[] }).events || []
      )
      .filter(event => event.date >= start && event.date <= end);
  }

  async function generate() {
    let start = fromDate;
    let end = toDate;
    if (command.trim()) {
      const parsed = parseNaturalRange(command);
      if ('error' in parsed) {
        notify({ tone: 'warn', text: parsed.error });
        return;
      }
      start = parsed.start;
      end = parsed.end;
      setFromDate(start);
      setToDate(end);
    }
    if (start > end) {
      notify({ tone: 'warn', text: 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด' });
      return;
    }
    setLoading(true);
    try {
      const [events, printIdentity] = await Promise.all([
        loadEvents(start, end),
        resolvePrintIdentity(connection),
      ]);
      const grouped = new Map<string, TeamupEvent[]>();
      events.forEach(event =>
        grouped.set(event.date, [...(grouped.get(event.date) || []), event])
      );
      const pages: PdfDay[] = skipEmpty
        ? Array.from(grouped.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, pageEvents]) => ({ date, events: pageEvents }))
        : (() => {
            const result: PdfDay[] = [];
            const a = isoParts(start);
            const b = isoParts(end);
            const cursor = new Date(Date.UTC(a.year, a.month - 1, a.day));
            const finish = new Date(Date.UTC(b.year, b.month - 1, b.day));
            while (cursor <= finish) {
              const date = toIso(
                cursor.getUTCFullYear(),
                cursor.getUTCMonth() + 1,
                cursor.getUTCDate()
              );
              result.push({ date, events: grouped.get(date) || [] });
              cursor.setUTCDate(cursor.getUTCDate() + 1);
            }
            return result;
          })();
      if (!pages.length) {
        notify({ tone: 'warn', text: 'ช่วงนี้ไม่มี Event ให้สร้าง PDF' });
        return;
      }
      const job: PdfJob = {
        id: `${Date.now()}`,
        start,
        end,
        createdAt: new Date().toISOString(),
        pages,
        printIdentity,
      };
      persist([job, ...jobs].slice(0, 20));
      setSelected(current => Array.from(new Set([job.id, ...current])));
      await downloadPdf(pages, `Teamup_${start}_to_${end}.pdf`, printIdentity);
      notify({
        tone: 'ok',
        text: `สร้าง PDF ${pages.length} หน้า และเก็บเข้า Queue แล้ว`,
      });
    } catch {
      notify({
        tone: 'error',
        text: 'สร้าง PDF ไม่สำเร็จ ตรวจ Teamup Connection แล้วลองใหม่',
      });
    } finally {
      setLoading(false);
    }
  }

  async function merge() {
    const picked = jobs.filter(job => selected.includes(job.id));
    if (!picked.length) {
      notify({ tone: 'warn', text: 'เลือกอย่างน้อย 1 batch ก่อน' });
      return;
    }
    setLoading(true);
    try {
      const fallbackIdentity = await resolvePrintIdentity(connection);
      const map = new Map<string, PdfDay>();
      picked.forEach(job =>
        job.pages.forEach(page =>
          map.set(page.date, {
            ...page,
            printIdentity: job.printIdentity || fallbackIdentity,
          })
        )
      );
      const pages = Array.from(map.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      await downloadPdf(
        pages,
        `Teamup_Merged_${pages[0].date}_to_${pages[pages.length - 1].date}.pdf`,
        fallbackIdentity
      );
      notify({
        tone: 'ok',
        text: `รวม ${picked.length} batch เป็น ${pages.length} หน้าแล้ว`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function downloadQueued(job: PdfJob) {
    const identity = job.printIdentity || (await resolvePrintIdentity(connection));
    await downloadPdf(
      job.pages,
      `Teamup_${job.start}_to_${job.end}.pdf`,
      identity
    );
  }

  return (
    <section className="workspace pdf-workspace">
      <div className="panel pdf-panel pdf-export-panel">
        <div className="panel-heading">
          <div>
            <h2>PDF Export</h2>
            <p>สร้างรายวัน เก็บหลายรอบ แล้ว Merge ภายหลัง</p>
          </div>
          <Printer size={20} />
        </div>
        <label className="command-box pdf-command-box">
          <span>Natural language command</span>
          <div>
            <input
              value={command}
              onChange={event => setCommand(event.target.value)}
              placeholder="ช่วยปริ้น ตั้งแต่วันที่ 20 AUG จนถึงล่าสุด"
            />
            <button className="secondary" onClick={readCommand}>
              Read Command
            </button>
          </div>
        </label>
        <div className="date-grid pdf-range-grid">
          <label>
            <span>From</span>
            <input
              type="date"
              value={fromDate}
              onChange={event => {
                setFromDate(event.target.value);
                setCommand('');
              }}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={toDate}
              onChange={event => {
                setToDate(event.target.value);
                setCommand('');
              }}
            />
          </label>
        </div>
        <label className="remember-row">
          <input
            type="checkbox"
            checked={skipEmpty}
            onChange={event => setSkipEmpty(event.target.checked)}
          />
          <span>Skip empty days</span>
        </label>
        <div className="pdf-print-account">
          <label>
            <span>ชื่อ / Email ที่พิมพ์มุมขวาบน (Optional)</span>
            <input
              value={connection?.printName || ''}
              onChange={event => onPrintNameChange(event.target.value)}
              placeholder="ชื่อใน Teamup หรือ Email"
            />
          </label>
          <small>
            ถ้าเว้นว่าง ระบบใช้ชื่อบัญชีหรือชื่อ Calendar Link จาก Teamup
            ชื่อปฏิทินมุมซ้ายจะดึงจาก Teamup อัตโนมัติ
          </small>
        </div>
        <div className="preset-row pdf-preset">
          <span>Print preset</span>
          <b>
            <Check size={12} /> Day View
          </b>
          <b>
            <Check size={12} /> Eco
          </b>
          <b>
            <Check size={12} /> Hide Sidebar
          </b>
          <b>
            <Check size={12} /> Portrait
          </b>
        </div>
        <button
          className="primary wide"
          disabled={loading}
          onClick={() => void generate()}
        >
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <FileText size={17} />
          )}
          {loading ? 'Working…' : 'Generate PDF'}
        </button>
      </div>
      <div className="panel queue-panel pdf-queue-panel">
        <div className="panel-heading">
          <div>
            <h2>PDF Queue</h2>
            <p>Queue เก็บบน browser เครื่องนี้</p>
          </div>
          <span className="count-badge">{jobs.length} batches</span>
        </div>
        <div className="queue-actions pdf-queue-actions">
          <button
            className="secondary"
            onClick={() =>
              setSelected(
                selected.length === jobs.length ? [] : jobs.map(job => job.id)
              )
            }
          >
            {selected.length === jobs.length && jobs.length
              ? 'Clear'
              : 'Select All'}
          </button>
          <button
            className="primary"
            disabled={!selected.length || loading}
            onClick={() => void merge()}
          >
            <Layers3 size={16} /> Merge Selected
          </button>
        </div>
        {jobs.length ? (
          <div className="queue-list pdf-job-list">
            {jobs.map(job => (
              <article key={job.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(job.id)}
                  onChange={() =>
                    setSelected(current =>
                      current.includes(job.id)
                        ? current.filter(id => id !== job.id)
                        : [...current, job.id]
                    )
                  }
                />
                <div>
                  <b>
                    {friendlyDate(job.start)} → {friendlyDate(job.end)}
                  </b>
                  <span>{job.pages.length} pages</span>
                </div>
                <button
                  title="Download"
                  onClick={() => void downloadQueued(job)}
                >
                  <Download size={16} />
                </button>
                <button
                  title="Remove"
                  onClick={() => {
                    const next = jobs.filter(item => item.id !== job.id);
                    persist(next);
                    setSelected(current => current.filter(id => id !== job.id));
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={28} />
            <b>No PDF batches yet</b>
            <span>สร้าง PDF รอบแรก แล้ว Queue จะมาอยู่ตรงนี้</span>
          </div>
        )}
      </div>
    </section>
  );
}

function PublicSettings({
  connection, localOnline, onConfigure, onGuide, onDisconnect,
}: {
  connection: Connection | null;
  localOnline: boolean | null;
  onConfigure: () => void;
  onGuide: () => void;
  onDisconnect: () => void;
}) {
  return (
    <section className="workspace single-workspace">
      <div className="panel settings-panel">
        <div className="panel-heading"><div><h2>Rules & Connection</h2><p>Same workflow as Teamup Assistant. Your calendar and data remain yours.</p></div><Settings size={20} /></div>
        <div className="settings-list">
          <div><span className="rule-icon"><Check /></span><div><b>English output only</b><p>Thai input is translated to concise English event titles.</p></div></div>
          <div><span className="rule-icon"><Check /></span><div><b>Khun naming convention</b><p>Thai honorific คุณ is translated as Khun.</p></div></div>
          <div><span className="rule-icon"><Clock3 /></span><div><b>Lunch lock 12:00-13:00</b><p>Work events split around lunch while leave can span lunch.</p></div></div>
          <div><span className="rule-icon"><Sparkles /></span><div><b>Auto color classification</b><p>Outside, Follow Up, Job Routine, Meeting and Leave.</p></div></div>
          <div className="connection-setting">
            <span className={'rule-icon ' + (connection ? '' : 'muted')}>{connection ? <Check /> : <RotateCcw />}</span>
            <div><b>Teamup API</b><p>{connection?.demo ? 'Demo mode. No Teamup account connected.' : connection ? 'Your connected calendar: ' + connection.calendarName : 'No Teamup connected. Every public user connects their own account.'}</p></div>
            <button type="button" onClick={onConfigure}>Configure</button>
          </div>
          <div className="connection-setting">
            <span className={'rule-icon ' + (localOnline ? '' : 'muted')}><Sparkles /></span>
            <div><b>AI processing • Local AI First</b><p>{localOnline ? 'Local AI worker online. AppDeploy AI automatic backup.' : 'Local AI offline or unavailable. AppDeploy AI automatic backup.'}</p><p>Uploaded attendance screenshots and work descriptions may be processed by BURANADEE-hosted Local AI via a secure job queue. Upload only information you may share.</p></div>
          </div>
          <div className="connection-setting">
            <span className="rule-icon"><BookOpen /></span><div><b>Public Edition Guide</b><p>Connect Teamup and use the workflow.</p></div><button type="button" onClick={onGuide}>Open Guide</button>
          </div>
          <div className="connection-setting">
            <span className="rule-icon"><ShieldCheck /></span><div><b>Privacy & disconnect</b><p>Disconnect clears this session’s Teamup connection, attendance and preview. PDF batches stay only on this device until removed.</p></div><button type="button" onClick={onDisconnect}>Disconnect</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function GuideView({ onStart }: { onStart: () => void }) {
  const steps = [
    ['1', 'เชื่อมต่อ Teamup', 'ใส่ API Key + Calendar Link แล้ว Map 5 หมวดงาน'],
    ['2', 'ใส่งาน / Attendance', 'พิมพ์งานภาษาไทย หรืออัปโหลดภาพเวลาเข้างาน'],
    ['3', 'Generate Schedule', 'ระบบแปลเป็น English Event และจัดสีอัตโนมัติ'],
    ['4', 'Review Preview', 'ตรวจวัน เวลา หัวข้องาน และหมวดหมู่'],
    ['5', 'Teamup / PDF', 'ส่งเข้าปฏิทินจริง หรือสร้าง PDF ไว้รวมภายหลัง'],
  ];
  const faq = [
    [
      'ต้องติดตั้งโปรแกรมไหม?',
      'ไม่ต้อง เป็นเว็บแอป ใช้ผ่าน browser บน Desktop หรือมือถือได้',
    ],
    [
      'Teamup API Key อยู่ที่ไหน?',
      'สร้างจากหน้า API Keys ของ Teamup และใช้ Calendar Link ที่มีสิทธิ์อ่าน/สร้าง Event',
    ],
    [
      'ถ้าชื่อ sub-calendar ไม่เหมือนตัวอย่างล่ะ?',
      'หน้า Connection ให้เลือก Mapping เองได้ 5 หมวด จึงไม่จำเป็นต้องตั้งชื่อเหมือนกัน',
    ],
    [
      'ใช้ภาษาไทยได้ไหม?',
      'ได้ Quick Input รองรับภาษาไทย แล้วระบบสร้างชื่อ Event ภาษาอังกฤษให้',
    ],
    [
      'PDF รวมทีหลังได้ไหม?',
      'ได้ ทุก batch เข้า PDF Queue บนเครื่องนั้น แล้วเลือก Merge ได้ภายหลัง',
    ],
  ];
  return (
    <section className="guide-page">
      <div className="guide-hero">
        <div>
          <span className="edition-pill">QUICK GUIDE</span>
          <h1>
            ใช้งาน Public Edition
            <br />
            ได้ใน 5 ขั้นตอน
          </h1>
          <p>
            เริ่มจาก Demo ได้ก่อน เมื่อ workflow เข้าใจแล้วค่อยเชื่อม Teamup
            จริง
          </p>
        </div>
        <button className="primary" onClick={onStart}>
          เริ่มใช้งาน <ArrowRight size={17} />
        </button>
      </div>
      <div className="guide-steps">
        {steps.map(([number, title, text]) => (
          <article key={number}>
            <span>{number}</span>
            <div>
              <b>{title}</b>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="guide-features">
        <h2>ฟีเจอร์หลัก</h2>
        <div className="feature-grid">
          <FeatureCard
            icon={<Sparkles />}
            title="Quick Input"
            text="ไทย → English Event พร้อมหมวดหมู่อัตโนมัติ"
          />
          <FeatureCard
            icon={<Clock3 />}
            title="Lunch Lock"
            text="กันช่วง 12:00–13:00 สำหรับงานปกติ"
          />
          <FeatureCard
            icon={<ClipboardList />}
            title="Attendance OCR"
            text="อ่าน Scanner time แล้วใช้ Auto-Time"
          />
          <FeatureCard
            icon={<CalendarDays />}
            title="Calendar Sync"
            text="ดู Teamup Event แบบรายเดือน"
          />
          <FeatureCard
            icon={<Printer />}
            title="PDF Export"
            text="Day View preset พร้อม Queue"
          />
          <FeatureCard
            icon={<Layers3 />}
            title="PDF Merge"
            text="รวมหลาย batch และเรียงตามวันที่"
          />
        </div>
      </div>
      <div className="example-grid">
        <article>
          <span>Schedule Example</span>
          <pre>{SAMPLE_INPUT}</pre>
        </article>
        <article>
          <span>PDF Command Example</span>
          <pre>ช่วยปริ้น ตั้งแต่วันที่ 20 AUG จนถึงล่าสุด</pre>
        </article>
      </div>
      <div className="faq-section">
        <div>
          <span className="section-kicker">FAQ</span>
          <h2>คำถามที่พบบ่อย</h2>
        </div>
        <div>
          {faq.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
      <div className="guide-security">
        <ShieldCheck size={25} />
        <div>
          <b>เรื่อง Credential</b>
          <p>
            เวอร์ชัน Public ไม่มี Teamup credential กลางของ BURANADEE
            ผู้ใช้เชื่อม Calendar ของตัวเอง และเลือกได้ว่าจะจำ credential
            บนอุปกรณ์หรือใช้เฉพาะ session
          </p>
        </div>
      </div>
    </section>
  );
}

export default PublicApp;
