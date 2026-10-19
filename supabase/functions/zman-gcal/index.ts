// זמן בכיף — 📆 סנכרון דו־כיווני עם יומן גוגל.
// GET ?auth=<nonce>          → מעביר לחלון ההסכמה של גוגל
// GET ?code=..&state=<nonce> → גוגל מחזיר לכאן; שומרים את החיבור וחוזרים לאפליקציה
// POST {action:'sync'} + משתמש מחובר → סנכרון עכשיו (רק שלו)
// POST + x-cron-secret       → סנכרון לכל המחוברים (כל 10 דקות)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) || '';
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const CID = env('ZMAN_GOOGLE_CLIENT_ID'), SECRET = env('ZMAN_GOOGLE_CLIENT_SECRET');
const SELF = `${env('SUPABASE_URL')}/functions/v1/zman-gcal`;
const APP = env('ZMAN_APP_URL') || 'https://zd0542964361.github.io/zman-bekef/';
const TZ = 'Asia/Jerusalem';
const G = 'https://www.googleapis.com/calendar/v3';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const back = (q: string) => new Response(null, { status: 302, headers: { Location: `${APP}?gcal=${q}` } });

async function token(refresh: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CID, client_secret: SECRET, refresh_token: refresh, grant_type: 'refresh_token' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('token: ' + (j.error || r.status)); return j.access_token as string;
}
const gfetch = async (at: string, path: string, init: RequestInit = {}) => {
  const r = await fetch(G + path, { ...init, headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (r.status === 204 || r.status === 410 || (init.method === 'DELETE' && r.status === 404)) return null;
  const j = await r.json(); if (!r.ok) throw new Error(`google ${r.status}: ${j.error?.message || ''}`); return j;
};

// ---------- משימה → אירוע ----------
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function toEvent(id: string, d: any) {
  const s = new Date(d.due), dur = d.hasTime ? Math.max(+d.dur || 0, 30) : 0;
  const ev: any = { summary: `${d.icon && d.icon !== '📆' ? d.icon + ' ' : ''}${d.text}`, extendedProperties: { private: { zmanId: id } },
    description: 'נוצר ב"זמן בכיף" ⏰' };
  if (d.hasTime) { ev.start = { dateTime: s.toISOString(), timeZone: TZ }; ev.end = { dateTime: new Date(+s + dur * 60e3).toISOString(), timeZone: TZ }; }
  else { const a = ymd(s), b = ymd(new Date(+s + 864e5)); ev.start = { date: a }; ev.end = { date: b }; }
  const r = d.repeat;
  if (r?.type === 'daily') ev.recurrence = ['RRULE:FREQ=DAILY'];
  else if (r?.type === 'weekly' && r.dows?.length) ev.recurrence = [`RRULE:FREQ=WEEKLY;BYDAY=${r.dows.map((x: number) => DOW[x]).join(',')}`];
  else if (r?.type === 'monthly' && r.dom) ev.recurrence = [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${r.dom}`];
  return ev;
}
// ---------- אירוע → משימה ----------
function fromEvent(ev: any, old: any) {
  const timed = !!ev.start?.dateTime, s = new Date(timed ? ev.start.dateTime : ev.start.date + 'T00:00:00+03:00');
  const e = timed ? new Date(ev.end?.dateTime || +s + 36e5) : null;
  const text = String(ev.summary || '(בלי שם)').replace(/^[^\p{L}\p{N}]+\s/u, '').slice(0, 200);
  return { ...(old || {}), text, due: s.toISOString(), hasTime: timed, dur: timed ? Math.round((+e! - +s) / 60e3) : null,
    place: ev.location ? String(ev.location).slice(0, 80) : old?.place || null };
}

async function want(prefs: any, d: any, owner: boolean) {
  if (!d || ['msg', 'reply', 'shop', 'habit', 'star', 'prize', 'thought'].includes(d.kind) || !d.due) return false;
  const evt = d.kind === 'meeting' || d.event;
  if (!owner) return !!prefs.family && (evt || d.hasTime);
  return evt ? prefs.events !== false : !!prefs.tasks && d.hasTime;
}

async function syncUser(row: any) {
  const uid = row.user_id, at = await token(row.refresh_token), cal = encodeURIComponent(row.calendar_id || 'primary');
  const prefs = row.prefs || {}, since = row.last_sync ? new Date(+new Date(row.last_sync) - 120e3) : null;
  const { data: maps } = await sb.from('zman_gcal_map').select('*').eq('user_id', uid);
  const byTask = new Map((maps || []).map((m: any) => [m.task_id, m])), byEvent = new Map((maps || []).map((m: any) => [m.event_id, m]));
  let pushed = 0, pulled = 0;

  // 1. מהאפליקציה לגוגל — רק מה שהשתנה מאז הפעם הקודמת
  let q = sb.from('zman_tasks').select('id,data,deleted,updated_at,created_by,assignee').or(`created_by.eq.${uid},assignee.eq.${uid}`).limit(2000);
  if (since) q = q.gt('updated_at', since.toISOString());
  const { data: rows } = await q;
  for (const t of rows || []) {
    const m: any = byTask.get(t.id);
    if (m?.task_updated && +new Date(m.task_updated) >= +new Date(t.updated_at)) continue; // כבר מסונכרן (או שהגיע מגוגל)
    const owner = (t.assignee || t.created_by) === uid;
    const gone = t.deleted || ['deleted', 'done'].includes(t.data?.status) && !t.data?.repeat;
    if (m && (gone || !(await want(prefs, t.data, owner)))) {
      if (t.deleted || t.data?.status === 'deleted') { await gfetch(at, `/calendars/${cal}/events/${m.event_id}`, { method: 'DELETE' }).catch(() => {}); await sb.from('zman_gcal_map').delete().eq('user_id', uid).eq('task_id', t.id); }
      else await sb.from('zman_gcal_map').update({ task_updated: t.updated_at }).eq('user_id', uid).eq('task_id', t.id);
      continue;
    }
    if (gone || !(await want(prefs, t.data, owner))) continue;
    const ev = toEvent(t.id, t.data);
    const res = m ? await gfetch(at, `/calendars/${cal}/events/${m.event_id}`, { method: 'PATCH', body: JSON.stringify(ev) }).catch(async (e) => /404|410/.test(String(e)) ? null : Promise.reject(e))
      : null;
    const out = res || await gfetch(at, `/calendars/${cal}/events`, { method: 'POST', body: JSON.stringify(ev) });
    await sb.from('zman_gcal_map').upsert({ user_id: uid, task_id: t.id, event_id: out.id, task_updated: t.updated_at, event_updated: out.updated });
    byEvent.set(out.id, { task_id: t.id, event_updated: out.updated }); pushed++;
  }

  // 2. מגוגל לאפליקציה — מה שהשתנה ביומן (90 יום קדימה)
  const p = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: '500', timeMin: new Date(Date.now() - 864e5).toISOString(), timeMax: new Date(Date.now() + 90 * 864e5).toISOString() });
  if (since) p.set('updatedMin', since.toISOString());
  let page: string | undefined;
  do {
    if (page) p.set('pageToken', page);
    const j = await gfetch(at, `/calendars/${cal}/events?${p}`);
    for (const ev of j.items || []) {
      const zid = ev.extendedProperties?.private?.zmanId;
      const m: any = byEvent.get(ev.id) || (zid ? byTask.get(zid) : null);
      if (m?.event_updated && +new Date(m.event_updated) >= +new Date(ev.updated)) continue; // השינוי שלנו
      if (zid && ev.recurringEventId) continue; // מופע של אירוע חוזר שלנו — המשימה הקבועה כבר אצלנו
      const taskId = m?.task_id || zid || ('g-' + ev.id).slice(0, 120);
      const { data: cur } = await sb.from('zman_tasks').select('data,deleted,created_by').eq('id', taskId).maybeSingle();
      if (ev.status === 'cancelled') {
        if (cur && !cur.deleted) await sb.from('zman_tasks').update({ deleted: true, data: { ...cur.data, status: 'deleted' } }).eq('id', taskId);
        await sb.from('zman_gcal_map').delete().eq('user_id', uid).eq('event_id', ev.id); pulled++; continue;
      }
      const base = cur?.data || { id: taskId, kind: 'meeting', event: true, icon: '📆', gcal: true, status: 'open', created: new Date().toISOString(), by: uid, repeat: null };
      const data = fromEvent(ev, base);
      const { data: up, error } = await sb.from('zman_tasks').upsert({ id: taskId, created_by: cur?.created_by || uid, group_id: null, private: false, deleted: false, data }, { onConflict: 'id' }).select('updated_at').single();
      if (error) { console.warn('pull', error.message); continue; }
      await sb.from('zman_gcal_map').upsert({ user_id: uid, task_id: taskId, event_id: ev.id, task_updated: up.updated_at, event_updated: ev.updated });
      pulled++;
    }
    page = j.nextPageToken;
  } while (page);

  await sb.from('zman_gcal').update({ last_sync: new Date().toISOString(), last_error: null }).eq('user_id', uid);
  return { pushed, pulled };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  try {
    // מתחילים חיבור
    const nonce = url.searchParams.get('auth');
    if (nonce) {
      if (!CID) return back('setup');
      const g = new URLSearchParams({ client_id: CID, redirect_uri: SELF, response_type: 'code', access_type: 'offline', prompt: 'consent',
        scope: 'https://www.googleapis.com/auth/calendar.events', state: nonce, include_granted_scopes: 'true' });
      return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${g}` } });
    }
    // גוגל חזר
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    if (url.searchParams.get('error')) return back('cancel');
    if (code && state) {
      const { data: n } = await sb.from('zman_gcal_nonce').select('*').eq('nonce', state).maybeSingle();
      if (!n || Date.now() - +new Date(n.created_at) > 15 * 60e3) return back('expired');
      await sb.from('zman_gcal_nonce').delete().eq('nonce', state);
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: CID, client_secret: SECRET, redirect_uri: SELF, grant_type: 'authorization_code' }) });
      const t = await r.json();
      if (!t.refresh_token) return back('norefresh');
      const cal = await gfetch(t.access_token, '/calendars/primary').catch(() => null);
      await sb.from('zman_gcal').upsert({ user_id: n.user_id, refresh_token: t.refresh_token, calendar_id: 'primary', email: cal?.id || null, last_sync: null, last_error: null, connected_at: new Date().toISOString() });
      await sb.from('zman_gcal_map').delete().eq('user_id', n.user_id);
      const { data: row } = await sb.from('zman_gcal').select('*').eq('user_id', n.user_id).single();
      await syncUser(row).catch(e => sb.from('zman_gcal').update({ last_error: String(e).slice(0, 200) }).eq('user_id', n.user_id));
      return back('ok');
    }
    if (req.method !== 'POST') return json({ ok: true });
    // כל 10 דקות
    if (req.headers.get('x-cron-secret') && req.headers.get('x-cron-secret') === env('ZMAN_CRON_SECRET')) {
      const { data: all } = await sb.from('zman_gcal').select('*').not('refresh_token', 'is', null).limit(200);
      let ok = 0, bad = 0;
      for (const row of all || []) {
        try { await syncUser(row); ok++; }
        catch (e) { bad++; await sb.from('zman_gcal').update({ last_error: String(e).slice(0, 200) }).eq('user_id', row.user_id); if (/invalid_grant/.test(String(e))) await sb.from('zman_gcal').update({ refresh_token: null }).eq('user_id', row.user_id); }
      }
      return json({ ok, bad });
    }
    // "🔄 לסנכרן עכשיו" — משתמש מחובר
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'not signed in' }, 401);
    const { data: row } = await sb.from('zman_gcal').select('*').eq('user_id', u.user.id).maybeSingle();
    if (!row?.refresh_token) return json({ error: 'not connected' }, 400);
    try { return json(await syncUser(row)); }
    catch (e) { await sb.from('zman_gcal').update({ last_error: String(e).slice(0, 200) }).eq('user_id', u.user.id); return json({ error: String(e) }, 500); }
  } catch (e) { console.warn(e); return json({ error: String(e) }, 500); }
});
