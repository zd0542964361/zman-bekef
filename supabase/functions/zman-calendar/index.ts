// זמן בכיף: 📆 יומן (ICS) עם המשימות, הפגישות והתזכורות שלי. נקרא עם מפתח סודי אישי (?t=…)
// ?t=demo: יומן לדוגמה (משפחה מדומה), לנסות לפני שמתחברים ולמצב הדגמה
// shared/parse.js הוא עותק של app/js/parse.js (להעתיק מחדש לפני כל פרסום של הפונקציה)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
const { nextOccurrence } = await import('./shared/parse.js');

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const TZ = 'Asia/Jerusalem';
const pad = (n: number) => String(n).padStart(2, '0');
const esc = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
// שורות ICS עד 75 בתים (עברית = 2 בתים לאות)
const fold = (l: string) => { const out: string[] = []; let cur = '', n = 0; const enc = new TextEncoder();
  for (const ch of l) { const b = enc.encode(ch).length; if (n + b > 73) { out.push(cur); cur = ' '; n = 1; } cur += ch; n += b; }
  out.push(cur); return out.join('\r\n'); };
// השרת רץ בשעון UTC. כל החישובים נעשים ב"שעון ישראל" שנשמר בשדות ה-UTC של התאריך, כמו שהאפליקציה מחשבת בטלפון
const il = (d: Date) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)); };
const dstr = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const tstr = (d: Date) => `${dstr(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
// יומן לדוגמה: כמה משימות, פגישות ותרופה, סביב היום (בשעון ישראל)
function demoRows() {
  const at = (days: number, h: number, m = 0) => { const n = il(new Date()); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + days, h - 3, m)).toISOString(); };
  const row = (id: string, d: any) => ({ id: 'demo-' + id, data: { status: 'open', hasTime: true, dur: 30, ...d } });
  return [
    row('bank', { text: 'להתקשר לבנק', icon: '📞', due: at(0, 10) }),
    row('yossi', { text: 'פגישה עם יוסי', icon: '👥', kind: 'meeting', due: at(1, 16), dur: 60, place: 'תל אביב' }),
    row('gan', { text: 'לאסוף את נועה מהגן', icon: '🎒', due: at(1, 13) }),
    row('shabbat', { text: 'הכנות לשבת', icon: '🕯️', due: at(2, 9), hasTime: false }),
    row('med', { text: 'אנטיביוטיקה', icon: '💊', due: at(0, 20), dur: 5, repeat: { type: 'daily', times: ['08:00', '20:00'], until: at(7, 12).slice(0, 10) } }),
    row('gannet', { text: 'לשלם לגננת', icon: '💳', due: at(1, 9), repeat: { type: 'weekly', dows: [4] } }),
  ];
}
const SKIP = ['msg', 'reply', 'shop', 'shoplist', 'habit', 'star', 'prize', 'thought', 'template'];

function event(uid: string, start: Date, d: any) {
  const timed = !!d.hasTime, dur = timed ? Math.max(+d.dur || 0, 15) : 0;
  const end = timed ? new Date(+start + dur * 60e3) : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
  const title = `${d.icon && d.icon !== '📆' ? d.icon + ' ' : ''}${d.text || ''}`;
  const desc = d.kind === 'meeting' ? 'פגישה מ"זמן בכיף" ⏰' : d.repeat ? 'תזכורת קבועה מ"זמן בכיף" ⏰' : 'משימה מ"זמן בכיף" ⏰';
  return ['BEGIN:VEVENT', `UID:${uid}@zmanbekef`, `DTSTAMP:${tstr(new Date())}Z`,
    timed ? `DTSTART;TZID=${TZ}:${tstr(start)}` : `DTSTART;VALUE=DATE:${dstr(start)}`,
    timed ? `DTEND;TZID=${TZ}:${tstr(end)}` : `DTEND;VALUE=DATE:${dstr(end)}`,
    fold(`SUMMARY:${esc(title)}`), fold(`DESCRIPTION:${esc(desc)}`), ...(d.place ? [fold(`LOCATION:${esc(d.place)}`)] : []),
    timed ? 'TRANSP:OPAQUE' : 'TRANSP:TRANSPARENT',
    ...(timed ? ['BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${esc(title)}`), 'TRIGGER:-PT10M', 'END:VALARM'] : []),
    'END:VEVENT'].join('\r\n');
}

Deno.serve(async req => {
  const t = new URL(req.url).searchParams.get('t') || '', demo = t === 'demo';
  let data: any[] | null = null;
  if (demo) data = demoRows();
  else {
    if (!/^[0-9a-f]{32,}$/.test(t)) return new Response('not found', { status: 404 });
    const { data: tok } = await sb.from('zman_cal_tokens').select('user_id').eq('token', t).maybeSingle();
    if (!tok) return new Response('not found', { status: 404 });
    const uid = tok.user_id;
    // שלי: מה שנתנו לי, ומה שרשמתי ולא נתתי למישהו אחר
    ({ data } = await sb.from('zman_tasks').select('id,data,created_by,assignee').eq('deleted', false)
      .or(`assignee.eq.${uid},and(created_by.eq.${uid},assignee.is.null)`).limit(3000));
  }
  const now = il(new Date()), from = new Date(+now - 30 * 864e5), to = new Date(+now + 120 * 864e5);
  const ev: string[] = [];
  for (const row of data || []) {
    const d = row.data; if (!d?.due || SKIP.includes(d.kind) || !['open', 'paused'].includes(d.status || 'open')) continue;
    const first = il(new Date(d.due));
    if (!d.repeat) { if (first >= from && first <= to) ev.push(event(row.id, first, d)); continue; }
    // תזכורת קבועה: כל המופעים ב-4 החודשים הקרובים (כולל לוח עברי, ראש חודש ותאריך סיום)
    let cur = new Date(+first - 60e3), k = 0;
    for (; k < 200; k++) {
      const nx = k === 0 ? first : nextOccurrence(d.repeat, first.getUTCHours(), first.getUTCMinutes(), cur);
      if (!nx || nx > to) break;
      ev.push(event(`${row.id}-${tstr(nx)}`, nx, d)); cur = nx;
    }
  }
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//zmanbekef//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', fold(`X-WR-CALNAME:⏰ זמן בכיף${demo ? ' (דוגמה)' : ''}`), fold('X-WR-CALDESC:משימות\\, פגישות ותזכורות מ"זמן בכיף"'), 'X-APPLE-CALENDAR-COLOR:#7C3AED', `X-WR-TIMEZONE:${TZ}`,
    'BEGIN:VTIMEZONE', `TZID:${TZ}`, 'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0200', 'TZNAME:IST', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:19700327T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0300', 'TZNAME:IDT', 'END:DAYLIGHT', 'END:VTIMEZONE',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...ev, 'END:VCALENDAR'].join('\r\n');
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'max-age=1800' } });
});
