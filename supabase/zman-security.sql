-- זמן בכיף — חיזוק אבטחה (19.10.2026)
-- 1. ילד לא רואה את קודי ההצטרפות (אחרת יכול להצטרף שוב כמבוגר)
revoke select on zman_groups from authenticated, anon;
grant select (id, name, kind, source_household, created_by, created_at) on zman_groups to authenticated;
create or replace function zman_group_codes()
returns table (id uuid, code text, child_code text)
language sql security definer stable set search_path = public as $$
  select g.id, g.code, g.child_code from zman_groups g join zman_members m on m.group_id = g.id and m.user_id = auth.uid()
  where m.role = 'admin' or (g.kind = 'pair' and m.role <> 'child');
$$;
revoke all on function zman_group_codes() from public, anon;
grant execute on function zman_group_codes() to authenticated;

-- 2. קודים ארוכים יותר (8 תווים, בלי 0/O/1/I שמתבלבלים)
create or replace function zman_new_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text; abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    c := '';
    for i in 1..8 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from zman_groups where code = c or child_code = c);
  end loop;
  return c;
end $$;

-- 3. הגבלת ניסיונות: עד 10 קודים שגויים ב-15 דקות
create table if not exists zman_join_attempts (user_id uuid not null, at timestamptz not null default now());
create index if not exists zman_join_attempts_u on zman_join_attempts (user_id, at);
alter table zman_join_attempts enable row level security; -- אין גישה ישירה, רק דרך הפונקציה

create or replace function zman_join_group(jcode text, nick text, emo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid; r text := 'member'; c text := upper(regexp_replace(coalesce(jcode, ''), '\s', '', 'g'));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if (select count(*) from zman_join_attempts where user_id = auth.uid() and at > now() - interval '15 minutes') >= 10 then raise exception 'too many tries'; end if;
  select id into g from zman_groups where code = c;
  if g is null then select id into g from zman_groups where child_code = c; r := 'child'; end if;
  if g is null then
    insert into zman_join_attempts (user_id) values (auth.uid());
    delete from zman_join_attempts where at < now() - interval '1 day';
    return null; -- הקוד לא נמצא (לא exception, כדי שהניסיון יישמר)
  end if;
  if (select kind from zman_groups where id = g) = 'pair' and (select count(*) from zman_members where group_id = g) >= 2
     and not zman_in_group(g) then raise exception 'pair full'; end if;
  insert into zman_members (group_id, user_id, nickname, emoji, role) values (g, auth.uid(), coalesce(nullif(trim(nick), ''), 'חבר'), emo, r)
    on conflict (group_id, user_id) do nothing;
  return g;
end $$;
