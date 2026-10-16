import { PDFDocument } from 'pdf-lib';

export type PrintView = 'day' | 'week' | 'month';
export type PrintColorMode = 'full' | 'eco';
export type PrintPaper = 'A4' | 'A3' | 'Letter';
export type TeamupPrintOptions = {
  view: PrintView;
  colorMode: PrintColorMode;
  paper: PrintPaper;
  orientation: 'portrait' | 'landscape';
  showLegend: boolean;
  legendIds: number[];
  startHour: number;
  endHour: number;
};

export type PrintCalendar = { id: number; name: string; color?: string };
export type PrintEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  categories: string[];
  subcalendarIds?: number[];
};
export type PrintIdentity = { calendarTitle: string; accountLabel: string; timeZone: string };
export type PrintDay = {
  date: string;
  events: PrintEvent[];
  printIdentity?: PrintIdentity;
  sidebar?: { visible: boolean; ids: number[]; calendars: PrintCalendar[] };
};
type RenderGroup = { key: string; label: string; days: PrintDay[]; view: PrintView };

export const DEFAULT_TEAMUP_PRINT: TeamupPrintOptions = {
  view: 'day',
  colorMode: 'eco',
  paper: 'A4',
  orientation: 'portrait',
  showLegend: false,
  legendIds: [],
  startHour: 8,
  endHour: 20,
};

const COLORS: Record<string, string> = {
  Outside: '#f18b50',
  'Follow Up': '#d6b844',
  'Job Routine': '#2c87ad',
  Meeting: '#86ad4b',
  Leave: '#e45c8c',
};
const FALLBACK_COLORS = ['#d6b844', '#e45c8c', '#2c87ad', '#86ad4b', '#f18b50', '#9377b8'];
const PAPER_PT: Record<PrintPaper, [number, number]> = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  Letter: [612, 792],
};

export function printPaperPoints(options: TeamupPrintOptions): [number, number] {
  const [width, height] = PAPER_PT[options.paper] || PAPER_PT.A4;
  return options.orientation === 'landscape' ? [height, width] : [width, height];
}
function dateUtc(iso: string) { return new Date(iso + 'T00:00:00Z'); }
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(dateUtc(iso));
}
function formatMonth(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateUtc(iso));
}
function formatClock(minutes: number) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
function weekStart(iso: string) {
  const date = dateUtc(iso);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return isoDate(date);
}
export function groupPrintPages(days: PrintDay[], view: PrintView): RenderGroup[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (view === 'day') return sorted.map(day => ({ key: day.date, label: formatDate(day.date), days: [day], view }));
  const groups = new Map<string, PrintDay[]>();
  sorted.forEach(day => {
    const key = view === 'month' ? day.date.slice(0, 7) : weekStart(day.date);
    groups.set(key, [...(groups.get(key) || []), day]);
  });
  return [...groups].map(([key, dayList]) => ({
    key,
    label: view === 'month' ? formatMonth(key + '-01') : 'Week of ' + formatDate(key),
    days: dayList,
    view,
  }));
}
export function visibleLegend(calendars: PrintCalendar[], options: TeamupPrintOptions): PrintCalendar[] {
  return options.showLegend ? calendars.filter(item => options.legendIds.includes(item.id)) : [];
}
export function printedEventCount(days: PrintDay[]): number {
  return days.reduce((sum, day) => sum + day.events.length, 0);
}
function hexColor(color: unknown): string | null {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}
function calendarColor(calendar: PrintCalendar, index: number) {
  return hexColor(calendar.color) || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}
function eventColors(event: PrintEvent, calendars: PrintCalendar[]): string[] {
  const ids = event.subcalendarIds || [];
  const colors = ids.map(id => {
    const index = calendars.findIndex(calendar => calendar.id === id);
    return index >= 0 ? calendarColor(calendars[index], index) : null;
  }).filter((value): value is string => Boolean(value));
  if (colors.length) return Array.from(new Set(colors));
  return Array.from(new Set(event.categories.map(category => COLORS[category] || '#2c87ad')));
}
function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return rgb.reduce((sum, x, i) => sum + (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)) * [0.2126, 0.7152, 0.0722][i], 0);
}
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(2, w), Math.max(2, h), Math.max(0, Math.min(radius, w / 2, h / 2)));
}
function drawLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, maxWidth: number, font: string, color: string, alignment: CanvasTextAlign = 'left') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = alignment;
  ctx.fillText(label, x, y, maxWidth);
  ctx.textAlign = 'left';
}
function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
    let chunk = '';
    for (const char of Array.from(word)) {
      if (chunk && ctx.measureText(chunk + char).width > maxWidth) { lines.push(chunk); chunk = char; }
      else chunk += char;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) {
  const lines = wrapWords(ctx, text, Math.max(width, 15));
  for (let i = 0; i < Math.min(maxLines, lines.length); i++) {
    ctx.fillText(lines[i], x, y + i * lineHeight, Math.max(width, 15));
  }
  return lines.length > maxLines;
}
function drawStripedBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colors: string[], mode: PrintColorMode) {
  const primary = colors[0] || '#2c87ad';
  roundedRect(ctx, x, y, w, h, 3);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = mode === 'eco' ? '#ffffff' : primary;
  ctx.fillRect(x, y, w, h);
  if (mode === 'full' && colors.length > 1) {
    const stripe = Math.max(12, Math.min(25, w / 14));
    const slope = h * 0.95;
    for (let i = -Math.ceil(slope / stripe) - 2; i <= Math.ceil((w + slope) / stripe) + 3; i++) {
      const sx = x + i * stripe;
      ctx.fillStyle = colors[((i % colors.length) + colors.length) % colors.length];
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + stripe, y + h);
      ctx.lineTo(sx + stripe + slope, y);
      ctx.lineTo(sx + slope, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (mode === 'eco') {
    ctx.fillStyle = primary;
    ctx.fillRect(x, y, Math.max(3.4, w * 0.01), h);
  }
  ctx.restore();
  roundedRect(ctx, x, y, w, h, 3);
  ctx.strokeStyle = primary;
  ctx.lineWidth = mode === 'eco' ? 0.85 : 0.5;
  ctx.stroke();
}
function eventPlacements(events: PrintEvent[]) {
  const timed = events.filter(event => !event.allDay).sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: PrintEvent[][] = [];
  let active: PrintEvent[] = [];
  let ending = -1;
  for (const event of timed) {
    if (event.start >= ending) { active = []; groups.push(active); }
    active.push(event);
    ending = Math.max(ending, event.end);
  }
  return groups.flatMap(group => {
    const columns: Array<Array<PrintEvent>> = [];
    const places = group.map(event => {
      let col = columns.findIndex(colItems => colItems.every(item => item.end <= event.start || event.end <= item.start));
      if (col < 0) { col = columns.length; columns.push([]); }
      columns[col].push(event);
      return { event, column: col };
    });
    return places.map(place => ({ ...place, columns: columns.length }));
  });
}
function canvasPage(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * 2);
  canvas.height = Math.round(height * 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PDF canvas unavailable');
  ctx.scale(2, 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}
export function officialDayGeometry(width: number, height: number, showLegend: boolean) {
  const left = width * (showLegend ? 0.341 : 0.080);
  return {
    legendX: width * 0.034,
    legendWidth: width * 0.226,
    headingX: width * (showLegend ? 0.298 : 0.032),
    left,
    right: width * 0.952,
    lineStart: left - width * 0.062,
    top: height * 0.141,
    bottom: height * 0.855,
    footerLine: height * 0.938,
  };
}
function isoWeekNumber(iso: string): number {
  const date = dateUtc(iso);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / 604800000);
}
function basePage(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  identity: PrintIdentity, label: string, pageNo?: string, footerStart?: number
) {
  const scale = Math.min(width / 595.28, height / 841.89);
  const margin = Math.max(8 * scale, width * 0.014);
  drawLabel(ctx, identity.calendarTitle || 'Teamup Calendar', margin, height * 0.042,
    width * 0.65, 'bold ' + (18 * scale) + 'px Arial', '#253746');
  drawLabel(ctx, identity.accountLabel || '', width - 36 * scale, height * 0.041,
    width * 0.31, (11 * scale) + 'px Arial', '#263b4d', 'right');
  ctx.strokeStyle = '#d6dfe5';
  ctx.lineWidth = Math.max(0.5, 0.8 * scale);
  ctx.beginPath();
  ctx.moveTo(margin, height * 0.061);
  ctx.lineTo(width - margin, height * 0.061);
  ctx.stroke();
  if (label) {
    drawLabel(ctx, label, 30 * scale, 76 * height / 841.89, width * 0.85,
      'bold ' + (14 * scale) + 'px Arial', '#273c4e');
  }
  ctx.strokeStyle = '#d8dddf';
  ctx.beginPath();
  ctx.moveTo(footerStart ?? margin, height * 0.938);
  ctx.lineTo(width - margin, height * 0.938);
  ctx.stroke();
  const baseline = height * 0.957;
  const zone = identity.timeZone.split('/').pop()?.replace(/_/g, ' ') || '';
  drawLabel(ctx, zone, width - 164 * scale, baseline, 75 * scale,
    (9 * scale) + 'px Arial', '#167eb4');
  drawLabel(ctx, 'Powered by', width - 96 * scale, baseline, 70 * scale,
    (9 * scale) + 'px Arial', '#7c878f');
  const markX = width - 43 * scale;
  const markY = baseline - 7 * scale;
  ctx.fillStyle = '#32475b';
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      ctx.fillRect(markX + col * 3.2 * scale, markY + row * 3.2 * scale, 1.9 * scale, 1.9 * scale);
    }
  }
  drawLabel(ctx, 'teamup', width - margin, baseline, 43 * scale,
    'bold ' + (9 * scale) + 'px Arial', '#32475b', 'right');
  if (pageNo) drawLabel(ctx, pageNo, margin, baseline, 110 * scale,
    (9 * scale) + 'px Arial', '#6c7881');
}
function ellipsize(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(clipped + '…').width > width) clipped = clipped.slice(0, -1);
  return clipped + '…';
}
function drawLegend(
  ctx: CanvasRenderingContext2D, calendars: PrintCalendar[], options: TeamupPrintOptions,
  x: number, y: number, width: number, maxHeight: number, scale = 1
) {
  const entries = visibleLegend(calendars, options);
  if (!entries.length) return;
  drawLabel(ctx, 'Calendars', x + width / 2, y, width - 10 * scale,
    'bold ' + (12 * scale) + 'px Arial', '#253746', 'center');
  const rowHeight = 13.6 * scale;
  const gap = 0.7 * scale;
  const maxItems = Math.max(0, Math.floor((maxHeight - 13 * scale) / (rowHeight + gap)));
  entries.slice(0, maxItems).forEach((calendar, index) => {
    const top = y + 13 * scale + index * (rowHeight + gap);
    const color = calendarColor(calendar, calendars.findIndex(item => item.id === calendar.id));
    const radius = options.colorMode === 'eco' ? 1 : 3 * scale;
    roundedRect(ctx, x, top, width, rowHeight, radius);
    ctx.fillStyle = options.colorMode === 'eco' ? '#ffffff' : color;
    ctx.fill();
    if (options.colorMode === 'eco') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.65 * scale;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(x, top, 3.4 * scale, rowHeight);
    }
    const font = (10.1 * scale) + 'px Arial';
    ctx.font = font;
    drawLabel(ctx, ellipsize(ctx, calendar.name, width - 12 * scale),
      x + 6 * scale, top + 10.1 * scale, width - 12 * scale,
      font, options.colorMode === 'eco' ? '#253746' : '#ffffff');
  });
}
function renderDay(day: PrintDay, identity: PrintIdentity, options: TeamupPrintOptions, calendars: PrintCalendar[]) {
  const [width, height] = printPaperPoints(options);
  const { canvas, ctx } = canvasPage(width, height);
  const legend = visibleLegend(calendars, options);
  const scale = Math.min(width / 595.28, height / 841.89);
  const g = officialDayGeometry(width, height, legend.length > 0);
  const { left, right, top, bottom, lineStart, headingX } = g;
  basePage(ctx, width, height, day.printIdentity || identity, '', undefined, legend.length ? lineStart : undefined);

  drawLabel(ctx, formatDate(day.date).replace(',', ''), headingX, height * 0.086,
    right - headingX, 'bold ' + (13 * scale) + 'px Arial', '#273746');
  drawLabel(ctx, 'W' + isoWeekNumber(day.date), headingX, height * 0.118,
    52 * scale, (10 * scale) + 'px Arial', '#263d50');
  const rightDate = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  }).format(dateUtc(day.date));
  drawLabel(ctx, rightDate, right - 2 * scale, height * 0.118,
    120 * scale, (11 * scale) + 'px Arial', '#263b4e', 'right');

  if (legend.length) {
    drawLegend(ctx, calendars, options, g.legendX, height * 0.086,
      g.legendWidth, bottom - height * 0.086, scale);
  }

  const timed = day.events.filter(event => !event.allDay);
  const starts = timed.map(event => event.start);
  const ends = timed.map(event => event.end);
  const from = Math.max(0, Math.min(options.startHour,
    starts.length ? Math.floor(Math.min(...starts) / 60) : options.startHour));
  const to = Math.min(24, Math.max(options.endHour,
    ends.length ? Math.ceil(Math.max(...ends) / 60) : options.endHour, from + 1));
  const minuteHeight = (bottom - top) / ((to - from) * 60);

  let truncated = false;
  const allDay = day.events.filter(event => event.allDay);
  if (allDay.length) {
    truncated = true;
    drawLabel(ctx, 'All day: ' + allDay.map(event => event.title).join(' • '),
      left + 4 * scale, top - 4 * scale, right - left - 8 * scale,
      'bold ' + (9 * scale) + 'px Arial', '#30465a');
  }

  // Official Teamup time ruler uses hourly markers and dotted quarter-hour lines.
  for (let minute = from * 60; minute <= to * 60; minute += 15) {
    const y = top + (minute - from * 60) * minuteHeight;
    const major = minute % 60 === 0;
    ctx.lineWidth = (major ? 0.75 : 0.48) * scale;
    ctx.strokeStyle = major ? '#cdd4d8' : '#dce2e6';
    ctx.setLineDash(major ? [] : [1.1 * scale, 1.45 * scale]);
    ctx.beginPath();
    ctx.moveTo(lineStart, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    if (major && minute < to * 60) {
      drawLabel(ctx, formatClock(minute), left - 3 * scale,
        y + 9.3 * scale, 46 * scale, (9.8 * scale) + 'px Arial',
        '#293c4c', 'right');
    }
  }
  ctx.setLineDash([]);

  eventPlacements(timed).forEach(({ event, column, columns }) => {
    const start = Math.max(event.start, from * 60);
    const end = Math.min(event.end, to * 60);
    if (end <= start) return;
    const y = top + (start - from * 60) * minuteHeight;
    const h = Math.max(7 * scale, (end - start) * minuteHeight - 0.75 * scale);
    const gap = 1.0 * scale;
    const w = (right - left) / columns;
    const x = left + column * w + gap;
    const blockWidth = Math.max(10 * scale, w - gap * 2);
    drawStripedBlock(ctx, x, y, blockWidth, h, eventColors(event, calendars), options.colorMode);
    ctx.fillStyle = options.colorMode === 'eco' ? '#263746' : '#ffffff';
    ctx.font = (9.4 * scale) + 'px Arial';
    const maxLines = Math.floor(Math.max(0, h - 7 * scale) / (11 * scale));
    if (!maxLines) {
      truncated = true;
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 4 * scale, y + 2 * scale, Math.max(2, blockWidth - 8 * scale),
      Math.max(1, h - 3 * scale));
    ctx.clip();
    truncated = drawWrapped(ctx, formatClock(event.start) + ' ' + event.title,
      x + 5.5 * scale, y + 10.5 * scale, blockWidth - 11 * scale,
      11 * scale, maxLines) || truncated;
    ctx.restore();
  });
  return { canvas, truncated };
}
function monthGridDates(month: string) {
  const first = dateUtc(month + '-01');
  const dayOfWeek = (first.getUTCDay() + 6) % 7;
  const beginning = new Date(first);
  beginning.setUTCDate(beginning.getUTCDate() - dayOfWeek);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const total = Math.ceil((dayOfWeek + last.getUTCDate()) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(beginning); d.setUTCDate(d.getUTCDate() + i); return isoDate(d);
  });
}
function renderGrid(group: RenderGroup, identity: PrintIdentity, options: TeamupPrintOptions, calendars: PrintCalendar[]) {
  const [width, height] = printPaperPoints(options);
  const { canvas, ctx } = canvasPage(width, height);
  basePage(ctx, width, height, identity, group.label, 'Event details on following page');
  const legend = visibleLegend(calendars, options);
  const legendWidth = legend.length ? Math.min(130, width * 0.22) : 0;
  const left = 25 + legendWidth;
  const top = 113;
  const right = width - 22;
  const bottom = height - 58;
  if (legend.length) drawLegend(ctx, calendars, options, 24, 112, legendWidth + 15, bottom - top);
  const calendarDays = new Map(group.days.map(day => [day.date, day]));
  const cells = group.view === 'month' ? monthGridDates(group.key) : Array.from({ length: 7 }, (_, i) => {
    const date = dateUtc(group.key); date.setUTCDate(date.getUTCDate() + i); return isoDate(date);
  });
  const rows = cells.length / 7;
  const cellW = (right - left) / 7;
  const cellH = (bottom - top - 17) / rows;
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((weekday, i) =>
    drawLabel(ctx, weekday, left + i * cellW + 5, top, cellW - 8, 'bold 10px Arial', '#34495a'));
  cells.forEach((iso, index) => {
    const col = index % 7;
    const row = Math.floor(index / 7);
    const x = left + col * cellW;
    const y = top + 17 + row * cellH;
    ctx.strokeStyle = '#d5dfe5';
    ctx.strokeRect(x, y, cellW, cellH);
    const isCurrent = group.view !== 'month' || iso.slice(0, 7) === group.key;
    ctx.fillStyle = isCurrent ? '#263443' : '#96a5af';
    drawLabel(ctx, iso.slice(8), x + 5, y + 14, cellW - 10, 'bold 11px Arial', ctx.fillStyle as string);
    const events = calendarDays.get(iso)?.events || [];
    const lineHeight = 21;
    const max = Math.max(0, Math.floor((cellH - 26) / lineHeight));
    events.slice(0, max).forEach((event, i) => {
      const rectY = y + 19 + i * lineHeight;
      const colors = eventColors(event, calendars);
      drawStripedBlock(ctx, x + 3, rectY, cellW - 6, lineHeight - 2, colors, options.colorMode);
      const dark = options.colorMode === 'eco' || luminance(colors[0]) > 0.43;
      drawLabel(ctx, event.allDay ? event.title : formatClock(event.start) + ' ' + event.title,
        x + 6, rectY + 13, cellW - 12, '8px Arial', dark ? '#233746' : '#ffffff');
    });
    if (events.length > max) {
      drawLabel(ctx, '+' + (events.length - max) + ' more in event details', x + 4, y + cellH - 4, cellW - 8, '8px Arial', '#51677a');
    }
  });
  return canvas;
}
function renderDetailPages(group: RenderGroup, identity: PrintIdentity, options: TeamupPrintOptions, calendars: PrintCalendar[]) {
  const [width, height] = printPaperPoints(options);
  const rows = group.days.flatMap(day => day.events.map(event => ({ date: day.date, event })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.event.start - b.event.start);
  const result: HTMLCanvasElement[] = [];
  let cursor = 0;
  while (cursor < rows.length) {
    const { canvas, ctx } = canvasPage(width, height);
    basePage(ctx, width, height, identity, group.label + ' — Event Details', 'Complete event titles');
    let y = 100;
    for (; cursor < rows.length; cursor++) {
      const row = rows[cursor];
      ctx.font = '11px Arial';
      const prefix = formatDate(row.date) + '  ' + (row.event.allDay ? 'All day' : formatClock(row.event.start) + '-' + formatClock(row.event.end)) + '  ';
      const lines = wrapWords(ctx, prefix + row.event.title, width - 100);
      const rowHeight = Math.max(22, lines.length * 14 + 8);
      if (y + rowHeight > height - 63) break;
      const color = eventColors(row.event, calendars)[0];
      ctx.fillStyle = color;
      ctx.fillRect(30, y, 4, rowHeight - 6);
      ctx.fillStyle = '#263443';
      ctx.font = '11px Arial';
      lines.forEach((line, i) => ctx.fillText(line, 44, y + 12 + i * 14, width - 85));
      y += rowHeight;
    }
    if (y === 100 && cursor < rows.length) throw new Error('Event title cannot fit in PDF details page');
    result.push(canvas);
  }
  return result;
}
export function renderTeamupPreview(days: PrintDay[], identity: PrintIdentity, options: TeamupPrintOptions): string {
  const groups = groupPrintPages(days, options.view);
  const first = groups[0];
  if (!first) return '';
  const calendars = first.days[0]?.sidebar?.calendars || [];
  const canvas = first.view === 'day' ? renderDay(first.days[0], identity, options, calendars).canvas
    : renderGrid(first, identity, options, calendars);
  return canvas.toDataURL('image/png');
}
export async function createTeamupPdf(days: PrintDay[], identity: PrintIdentity, options: TeamupPrintOptions) {
  const pdf = await PDFDocument.create();
  for (const group of groupPrintPages(days, options.view)) {
    const calendars = group.days[0]?.sidebar?.calendars || [];
    const rendered = group.view === 'day' ? renderDay(group.days[0], identity, options, calendars) : null;
    const primary = rendered?.canvas || renderGrid(group, identity, options, calendars);
    const canvases = [primary, ...(group.view !== 'day' || rendered?.truncated
      ? renderDetailPages(group, identity, options, calendars) : [])];
    for (const canvas of canvases) {
      const [width, height] = printPaperPoints(options);
      const image = await pdf.embedPng(canvas.toDataURL('image/png'));
      const page = pdf.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
    }
  }
  return pdf.save();
}
