-- זמן בכיף — 📆 חיבור ליומן גוגל. הטוקנים נשמרים רק כאן, ורק השרת (service role) קורא אותם.
create table if not exists zman_gcal (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text,
  calendar_id text not null default 'primary',
  sync_token text,
  prefs jsonb not null default '{"events": true, "tasks": false, "family": false}',
  email text,
  last_sync timestamptz,
  last_error text,
  connected_at timestamptz
);
alter table zman_gcal enable row level security; -- אין גישה ישירה מהאפליקציה
create table if not exists zman_gcal_nonce (nonce text primary key, user_id uuid not null, created_at timestamptz not null default now());
alter table zman_gcal_nonce enable row level security;

-- מתחילים חיבור: מספר חד־פעמי שמזהה את המשתמש בחזרה מגוגל (תקף 15 דקות)
create or replace function zman_gcal_start() returns text
language plpgsql security definer set search_path = public as $$
declare n text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from zman_gcal_nonce where created_at < now() - interval '15 minutes' or user_id = auth.uid();
  insert into zman_gcal_nonce (nonce, user_id) values (n, auth.uid());
  return n;
end $$;
-- מצב החיבור שלי (בלי הטוקן)
create or replace function zman_gcal_status() returns table (connected boolean, email text, prefs jsonb, last_sync timestamptz, last_error text)
language sql security definer stable set search_path = public as $$
  select refresh_token is not null, email, prefs, last_sync, last_error from zman_gcal where user_id = auth.uid();
$$;
create or replace function zman_gcal_prefs(p jsonb) returns void
language sql security definer set search_path = public as $$
  update zman_gcal set prefs = p where user_id = auth.uid();
$$;
-- ניתוק: מוחקים את הטוקן (מה שכבר ביומן נשאר)
create or replace function zman_gcal_disconnect() returns void
language sql security definer set search_path = public as $$
  delete from zman_gcal where user_id = auth.uid();
$$;
revoke all on function zman_gcal_start() from public, anon;
revoke all on function zman_gcal_status() from public, anon;
revoke all on function zman_gcal_prefs(jsonb) from public, anon;
revoke all on function zman_gcal_disconnect() from public, anon;
grant execute on function zman_gcal_start() to authenticated;
grant execute on function zman_gcal_status() to authenticated;
grant execute on function zman_gcal_prefs(jsonb) to authenticated;
grant execute on function zman_gcal_disconnect() to authenticated;

-- "תאומים": איזו משימה מתאימה לאיזה אירוע בגוגל (כדי שלא יהיו כפילויות ולא יהיה סיבוב אינסופי)
create table if not exists zman_gcal_map (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  event_id text not null,
  task_updated timestamptz,
  event_updated timestamptz,
  primary key (user_id, task_id)
);
create unique index if not exists zman_gcal_map_ev on zman_gcal_map (user_id, event_id);
alter table zman_gcal_map enable row level security;
