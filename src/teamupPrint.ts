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
  roundedRect(ctx, x, y, w, h, 3);
  ctx.save();
  ctx.clip();
  const primary = colors[0] || '#2c87ad';
  ctx.fillStyle = mode === 'eco' ? '#ffffff' : primary;
  ctx.fillRect(x, y, w, h);
  if (mode === 'full' && colors.length > 1) {
    const stripeWidth = 18;
    const steps = Math.ceil((w + h) / stripeWidth) + 3;
    for (let i = -Math.ceil(h / stripeWidth) - 1; i <= steps; i++) {
      ctx.fillStyle = colors[(i % colors.length + colors.length) % colors.length];
      ctx.beginPath();
      const sx = x + i * stripeWidth;
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + stripeWidth, y + h);
      ctx.lineTo(sx + stripeWidth + h * 0.68, y);
      ctx.lineTo(sx + h * 0.68, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (mode === 'eco' && colors.length > 1) {
    colors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(x + (i * w) / colors.length, y, w / colors.length, 3);
    });
  }
  ctx.restore();
  roundedRect(ctx, x, y, w, h, 3);
  ctx.strokeStyle = primary;
  ctx.lineWidth = mode === 'eco' ? 1.8 : 0.5;
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
function basePage(ctx: CanvasRenderingContext2D, width: number, height: number, identity: PrintIdentity, label: string, pageNo?: string) {
  drawLabel(ctx, identity.calendarTitle || 'Teamup Calendar', 24, 35, width * 0.6, 'bold 18px Arial', '#263443');
  drawLabel(ctx, identity.accountLabel || '', width - 24, 35, width * 0.33, '12px Arial', '#293b4a', 'right');
  ctx.strokeStyle = '#dce3e7';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(24, 51); ctx.lineTo(width - 24, 51); ctx.stroke();
  drawLabel(ctx, label, 30, 76, width - 60, 'bold 14px Arial', '#273c4e');
  ctx.beginPath(); ctx.moveTo(24, height - 35); ctx.lineTo(width - 24, height - 35); ctx.stroke();
  const zone = identity.timeZone.split('/').pop()?.replace(/_/g, ' ') || '';
  drawLabel(ctx, zone, width - 160, height - 18, 100, '9px Arial', '#237caa');
  drawLabel(ctx, 'Powered by teamup', width - 24, height - 18, 132, '10px Arial', '#6c7881', 'right');
  if (pageNo) drawLabel(ctx, pageNo, 24, height - 18, 60, '9px Arial', '#6c7881');
}
function drawLegend(ctx: CanvasRenderingContext2D, calendars: PrintCalendar[], options: TeamupPrintOptions, x: number, y: number, width: number, maxHeight: number) {
  const entries = visibleLegend(calendars, options);
  if (!entries.length) return;
  drawLabel(ctx, 'Calendars', x + 7, y, width - 12, 'bold 12px Arial', '#263443');
  const rowHeight = Math.min(20, Math.max(12, (maxHeight - 35) / entries.length));
  entries.forEach((calendar, i) => {
    const rowTop = y + 14 + i * rowHeight;
    const color = calendarColor(calendar, calendars.findIndex(item => item.id === calendar.id));
    ctx.fillStyle = color;
    roundedRect(ctx, x + 6, rowTop, Math.max(10, width - 12), rowHeight - 2, 3);
    ctx.fill();
    drawLabel(ctx, calendar.name, x + 12, rowTop + rowHeight - 7, width - 25, '10px Arial', luminance(color) > 0.43 ? '#263443' : '#ffffff');
  });
}
function renderDay(day: PrintDay, identity: PrintIdentity, options: TeamupPrintOptions, calendars: PrintCalendar[]) {
  const [width, height] = printPaperPoints(options);
  const { canvas, ctx } = canvasPage(width, height);
  basePage(ctx, width, height, day.printIdentity || identity, formatDate(day.date));
  const legend = visibleLegend(calendars, options);
  const legendWidth = legend.length ? Math.min(155, width * 0.28) : 0;
  const left = 65 + legendWidth;
  const right = width - 24;
  const top = 116;
  const bottom = height - 65;
  if (legend.length) drawLegend(ctx, calendars, options, 24, 112, legendWidth + 22, bottom - top);
  const timed = day.events.filter(event => !event.allDay);
  const starts = timed.map(event => event.start);
  const ends = timed.map(event => event.end);
  const from = Math.max(0, Math.min(options.startHour, starts.length ? Math.floor(Math.min(...starts) / 60) : options.startHour));
  const to = Math.min(24, Math.max(options.endHour, ends.length ? Math.ceil(Math.max(...ends) / 60) : options.endHour, from + 1));
  const minuteHeight = (bottom - top) / ((to - from) * 60);
  const allDay = day.events.filter(event => event.allDay);
  if (allDay.length) {
    drawLabel(ctx, 'All day: ' + allDay.map(item => item.title).join(' • '), left + 5, 105, right - left - 5, 'bold 10px Arial', '#30465a');
  }
  for (let hour = from; hour <= to; hour++) {
    const y = top + (hour - from) * 60 * minuteHeight;
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = '#dce2e5';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    if (hour < to) drawLabel(ctx, formatClock(hour * 60), left - 8, y + 3.5, 48, '10px Arial', '#5b6b79', 'right');
  }
  let truncated = false;
  eventPlacements(timed).forEach(({ event, column, columns }) => {
    const start = Math.max(event.start, from * 60);
    const end = Math.min(event.end, to * 60);
    if (end <= start) return;
    const y = top + (start - from * 60) * minuteHeight;
    const h = Math.max(7, (end - start) * minuteHeight - 1);
    const gap = 1.5;
    const w = (right - left) / columns;
    const x = left + column * w + gap;
    const rectW = Math.max(10, w - gap * 2);
    const colors = eventColors(event, calendars);
    drawStripedBlock(ctx, x, y, rectW, h, colors, options.colorMode);
    const dark = options.colorMode === 'eco' || (colors.length === 1 && luminance(colors[0]) > 0.43);
    ctx.fillStyle = dark ? '#243646' : '#ffffff';
    ctx.font = '9.2px Arial';
    const availableHeight = Math.max(0, h - 8);
    const maxLines = Math.floor(availableHeight / 11);
    if (!maxLines) { truncated = true; return; }
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 4, y + 2, rectW - 8, h - 3); ctx.clip();
    truncated = drawWrapped(ctx, formatClock(event.start) + ' ' + event.title, x + 5, y + 11, rectW - 10, 11, maxLines) || truncated;
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
