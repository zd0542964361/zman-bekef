// זמן בכיף — מייל סיכום חודשי. רץ ב-1 לכל חודש (pg_cron), שולח לכל מי שלא כיבה את זה בהגדרות.
// שליחה דרך ג'ימייל (SMTP בפורט 465, סיסמת אפליקציה) — אותו ג'ימייל של "כסף בכיף".
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import nodemailer from 'npm:nodemailer@6.9.14';

const env = (...k: string[]) => k.map(x => Deno.env.get(x)).find(Boolean) || '';
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const GMAIL_USER = env('ZMAN_GMAIL_USER', 'GMAIL_USER'), GMAIL_PASS = env('ZMAN_GMAIL_APP_PASSWORD', 'GMAIL_APP_PASSWORD');
const APP_URL = env('ZMAN_APP_URL') || 'https://zmanbekef.github.io/';
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// גבולות חודש לפי שעון ישראל
function monthRange(y: number, m: number) {
  const tz = (d: Date) => { const s = d.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }); return d.getTime() - new Date(s).getTime(); };
  const a = new Date(Date.UTC(y, m, 1)), b = new Date(Date.UTC(y, m + 1, 1));
  return [new Date(a.getTime() + tz(a)), new Date(b.getTime() + tz(b))];
}

function mailHtml(name: string, month: string, s: { done: string[]; open: string[]; next: string[]; doneN: number; openN: number; nextN: number; thoughts: number }) {
  const list = (a: string[], more: number) => a.length ? `<ul style="margin:6px 0 0;padding-inline-start:20px">${a.map(t => `<li>${esc(t)}</li>`).join('')}${more > a.length ? `<li style="color:#888">ועוד ${more - a.length}…</li>` : ''}</ul>` : '<p style="color:#888;margin:6px 0 0">אין</p>';
  const box = (t: string, n: number, c: string) => `<td style="padding:6px"><div style="background:${c};border-radius:14px;padding:12px;text-align:center;color:#fff"><b style="font-size:26px">${n}</b><br><small>${t}</small></div></td>`;
  return `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#fff;color:#111;padding:20px;border-radius:18px">
  <h2 style="margin:0 0 4px">⏰ זמן בכיף · סיכום ${month}</h2><p style="margin:0 0 14px;color:#555">שלום ${esc(name)} 👋 ככה נראה החודש שלך:</p>
  <table style="width:100%;border-collapse:collapse"><tr>${box('בוצעו', s.doneN, '#22C55E')}${box('נשארו פתוחות', s.openN, '#F97316')}${box('בחודש הבא', s.nextN, '#7C3AED')}</tr></table>
  <h3 style="margin:18px 0 0">✅ מה עשית</h3>${list(s.done, s.doneN)}
  <h3 style="margin:18px 0 0">📌 מה עוד מחכה</h3>${list(s.open, s.openN)}
  <h3 style="margin:18px 0 0">📅 בחודש הבא</h3>${list(s.next, s.nextN)}
  ${s.thoughts ? `<p style="margin-top:16px">💭 יש לך ${s.thoughts} מחשבות בתיבה. אולי זה הזמן לעבור עליהן?</p>` : ''}
  <p style="margin-top:20px"><a href="${APP_URL}" style="background:#7C3AED;color:#fff;padding:10px 18px;border-radius:12px;text-decoration:none">לפתוח את זמן בכיף</a></p>
  <p style="color:#999;font-size:12px;margin-top:18px">לא רוצה את המייל הזה? אפשר לכבות אותו בהגדרות ← סיכומים.</p></div>`;
}

Deno.serve(async req => {
  if (req.headers.get('x-cron-secret') !== env('ZMAN_CRON_SECRET')) return new Response('no', { status: 401 });
  if (!GMAIL_USER || !GMAIL_PASS) return new Response('missing gmail secrets', { status: 500 });
  const body = await req.json().catch(() => ({}));
  const now = new Date(), il = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const y = il.getMonth() === 0 ? il.getFullYear() - 1 : il.getFullYear(), m = (il.getMonth() + 11) % 12; // החודש שעבר
  const key = `${y}-${String(m + 1).padStart(2, '0')}`;
  const [from, to] = monthRange(y, m), [, nextEnd] = monthRange(y, m + 1);
  const mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_PASS } });

  let q = sb.from('zman_profiles').select('*').eq('monthly_email', true);
  if (body.only) q = q.eq('user_id', body.only); // בדיקה: רק למשתמש אחד
  else q = q.or(`monthly_sent.is.null,monthly_sent.neq.${key}`);
  const { data: profs, error } = await q.limit(500);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, failed = 0;
  for (const p of profs ?? []) {
    const { data: u } = await sb.auth.admin.getUserById(p.user_id);
    const to_ = u?.user?.email; if (!to_) continue;
    const { data: rows } = await sb.from('zman_tasks').select('data,assignee,created_by').eq('deleted', false)
      .or(`created_by.eq.${p.user_id},assignee.eq.${p.user_id}`).limit(5000);
    const items = (rows ?? []).map(r => r.data).filter((d: any) => d && !['msg', 'reply', 'shop', 'habit', 'star', 'prize'].includes(d.kind));
    const inM = (t?: string) => !!t && new Date(t) >= from && new Date(t) < to;
    const done = items.filter((d: any) => inM(d.doneAt) || (d.repeat && inM(d.lastDone)));
    const open = items.filter((d: any) => d.status === 'open' && d.kind !== 'thought' && (!d.due || new Date(d.due) < to));
    const next = items.filter((d: any) => d.status === 'open' && d.due && new Date(d.due) >= to && new Date(d.due) < nextEnd);
    const thoughts = items.filter((d: any) => d.status === 'open' && d.kind === 'thought').length;
    const t = (a: any[]) => a.slice(0, 8).map(d => d.text);
    try {
      await mailer.sendMail({ from: `"זמן בכיף ⏰" <${GMAIL_USER}>`, to: to_, subject: `⏰ סיכום ${MONTHS[m]} שלך בזמן בכיף`,
        html: mailHtml(p.full_name || '', MONTHS[m], { done: t(done), open: t(open), next: t(next), doneN: done.length, openN: open.length, nextN: next.length, thoughts }) });
      if (!body.only) await sb.from('zman_profiles').update({ monthly_sent: key }).eq('user_id', p.user_id);
      sent++;
    } catch (e) { console.warn('mail', p.user_id, e); failed++; }
  }
  return new Response(JSON.stringify({ month: key, sent, failed }), { headers: { 'Content-Type': 'application/json' } });
});
