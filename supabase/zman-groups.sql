-- זמן בכיף — קבוצות (משפחה / שותפים / צוות / חברים / קשר פרטי), כינויים, ומשימות לפי קבוצה.
-- טבלאות חדשות בלבד עם קידומת zman_. לא נוגע בטבלאות של כסף בכיף.

-- ---------- פרופיל: שם מלא ואייקון ----------
create table if not exists zman_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  full_name text,
  emoji text,
  updated_at timestamptz not null default now()
);

-- ---------- קבוצות וחברים ----------
create table if not exists zman_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'other' check (kind in ('family', 'partners', 'team', 'friends', 'other', 'pair')),
  code text unique not null,
  child_code text unique,
  source_household uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists zman_members (
  id text primary key default gen_random_uuid()::text,
  group_id uuid not null references zman_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,   -- ריק = "רק שם" (ילד בלי טלפון)
  nickname text not null,
  emoji text,
  role text not null default 'member' check (role in ('admin', 'member', 'child')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create or replace function zman_in_group(g uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from zman_members where group_id = g and user_id = auth.uid());
$$;
create or replace function zman_group_role(g uuid) returns text
language sql security definer stable set search_path = public as $$
  select role from zman_members where group_id = g and user_id = auth.uid();
$$;
create or replace function zman_shares_group(u uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from zman_members a join zman_members b on a.group_id = b.group_id where a.user_id = auth.uid() and b.user_id = u);
$$;

alter table zman_profiles enable row level security;
alter table zman_groups enable row level security;
alter table zman_members enable row level security;
drop policy if exists "zp read" on zman_profiles;
drop policy if exists "zp write" on zman_profiles;
drop policy if exists "zp update" on zman_profiles;
create policy "zp read" on zman_profiles for select using (user_id = auth.uid() or zman_shares_group(user_id));
create policy "zp write" on zman_profiles for insert with check (user_id = auth.uid());
create policy "zp update" on zman_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "zg read" on zman_groups;
drop policy if exists "zg update" on zman_groups;
create policy "zg read" on zman_groups for select using (zman_in_group(id));
create policy "zg update" on zman_groups for update using (zman_group_role(id) = 'admin') with check (zman_group_role(id) = 'admin');
drop policy if exists "zm read" on zman_members;
create policy "zm read" on zman_members for select using (zman_in_group(group_id));
-- כל השינויים בחברים — רק דרך הפונקציות למטה

create or replace function zman_new_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from zman_groups where code = c or child_code = c);
  end loop;
  return c;
end $$;

-- קבוצה חדשה (היוצר הוא מנהל)
create or replace function zman_create_group(gname text, gkind text, nick text, emo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into zman_groups (name, kind, code, child_code, created_by)
    values (coalesce(nullif(trim(gname), ''), 'הקבוצה שלי'), gkind, zman_new_code(), case when gkind = 'family' then zman_new_code() end, auth.uid())
    returning id into g;
  insert into zman_members (group_id, user_id, nickname, emoji, role) values (g, auth.uid(), coalesce(nullif(trim(nick), ''), 'אני'), emo, 'admin');
  return g;
end $$;

-- הצטרפות עם קוד (קוד ילד → תפקיד ילד)
create or replace function zman_join_group(jcode text, nick text, emo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid; r text := 'member'; c text := upper(trim(jcode));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into g from zman_groups where code = c;
  if g is null then select id into g from zman_groups where child_code = c; r := 'child'; end if;
  if g is null then raise exception 'bad code'; end if;
  if (select kind from zman_groups where id = g) = 'pair' and (select count(*) from zman_members where group_id = g) >= 2
     and not zman_in_group(g) then raise exception 'pair full'; end if;
  insert into zman_members (group_id, user_id, nickname, emoji, role) values (g, auth.uid(), coalesce(nullif(trim(nick), ''), 'חבר'), emo, r)
    on conflict (group_id, user_id) do nothing;
  return g;
end $$;

-- כינוי ואייקון שלי בקבוצה
create or replace function zman_set_nickname(g uuid, nick text, emo text)
returns void language sql security definer set search_path = public as $$
  update zman_members set nickname = coalesce(nullif(trim(nick), ''), nickname), emoji = coalesce(emo, emoji) where group_id = g and user_id = auth.uid();
$$;

-- מנהל: הוספת "רק שם", שינוי תפקיד, הסרה. כל אחד: יציאה מקבוצה.
create or replace function zman_add_name(g uuid, nick text, emo text)
returns text language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if zman_group_role(g) is distinct from 'admin' then raise exception 'not admin'; end if;
  insert into zman_members (group_id, user_id, nickname, emoji, role) values (g, null, nick, emo, 'child') returning id into m;
  return m;
end $$;
create or replace function zman_set_role(mid text, new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  select group_id into g from zman_members where id = mid;
  if zman_group_role(g) is distinct from 'admin' then raise exception 'not admin'; end if;
  if new_role <> 'admin' and (select role from zman_members where id = mid) = 'admin'
     and (select count(*) from zman_members where group_id = g and role = 'admin') <= 1 then raise exception 'last admin'; end if;
  update zman_members set role = new_role where id = mid;
end $$;
create or replace function zman_remove_member(mid text)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid; u uuid; r text;
begin
  select group_id, user_id, role into g, u, r from zman_members where id = mid;
  if g is null then return; end if;
  if u is distinct from auth.uid() and zman_group_role(g) is distinct from 'admin' then raise exception 'not admin'; end if;
  if r = 'admin' and (select count(*) from zman_members where group_id = g and role = 'admin' and user_id is not null) <= 1
     and (select count(*) from zman_members where group_id = g and user_id is not null) > 1 then raise exception 'last admin'; end if;
  delete from zman_members where id = mid;
  -- קבוצה שנשארה בלי אף אחד עם חשבון — נמחקת
  if not exists (select 1 from zman_members where group_id = g and user_id is not null) then delete from zman_groups where id = g; end if;
end $$;

-- קבוצה מהמשפחה של כסף בכיף (כל בני הבית עם חשבון נכנסים, עם התפקיד שלהם והשם מהרשימה)
create or replace function zman_import_household(h uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid; hname text; ppl jsonb;
begin
  if not exists (select 1 from members where household_id = h and user_id = auth.uid()) then raise exception 'not member'; end if;
  select id into g from zman_groups where source_household = h;
  if g is null then
    select name into hname from households where id = h;
    insert into zman_groups (name, kind, code, child_code, source_household, created_by)
      values (coalesce(hname, 'המשפחה'), 'family', zman_new_code(), zman_new_code(), h, auth.uid()) returning id into g;
  end if;
  select value into ppl from kv where household_id = h and key = 'people';
  insert into zman_members (group_id, user_id, nickname, emoji, role)
    select g, m.user_id,
      coalesce((select p->>'name' from jsonb_array_elements(coalesce(ppl, '[]'::jsonb)) p where p->>'uid' = m.user_id::text limit 1), 'בן משפחה'),
      (select p->>'e' from jsonb_array_elements(coalesce(ppl, '[]'::jsonb)) p where p->>'uid' = m.user_id::text limit 1),
      case when m.role = 'child' then 'child' else 'admin' end
    from members m where m.household_id = h
    on conflict (group_id, user_id) do nothing;
  return g;
end $$;

-- ---------- משימות לפי קבוצה ----------
create table if not exists zman_tasks (
  id text primary key,
  group_id uuid references zman_groups(id) on delete set null,
  created_by uuid not null default auth.uid(),
  assignee uuid,
  private boolean not null default false,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists zman_tasks_updated on zman_tasks (updated_at);
drop trigger if exists zman_tasks_touch on zman_tasks;
create trigger zman_tasks_touch before insert or update on zman_tasks for each row execute function touch_updated();
alter table zman_tasks enable row level security;

create or replace function zman_task_visible(g uuid, creator uuid, assigned uuid, priv boolean) returns boolean
language sql security definer stable set search_path = public as $$
  select creator = auth.uid() or assigned = auth.uid()
    or (g is not null and not priv and zman_in_group(g) and zman_group_role(g) <> 'child');
$$;
drop policy if exists "zt read" on zman_tasks;
drop policy if exists "zt insert" on zman_tasks;
drop policy if exists "zt update" on zman_tasks;
drop policy if exists "zt delete" on zman_tasks;
create policy "zt read" on zman_tasks for select using (zman_task_visible(group_id, created_by, assignee, private));
create policy "zt insert" on zman_tasks for insert with check (created_by = auth.uid() and (group_id is null or zman_in_group(group_id)));
create policy "zt update" on zman_tasks for update using (zman_task_visible(group_id, created_by, assignee, private))
  with check (zman_task_visible(group_id, created_by, assignee, private) and (group_id is null or zman_in_group(group_id)));
create policy "zt delete" on zman_tasks for delete using (created_by = auth.uid());

-- זמנים תפוסים של מי שאני בקבוצה איתו — רק "מתי", בלי "מה", ורק מה שאני לא רואה בעצמי
create or replace function zman_busy2()
returns table (id text, owner uuid, due text, dur int)
language sql security definer stable set search_path = public as $$
  select t.id, coalesce(t.assignee, t.created_by), t.data->>'due', coalesce((t.data->>'dur')::int, 0)
  from zman_tasks t
  where not t.deleted and t.data->>'status' = 'open' and t.data->>'due' is not null and coalesce(t.data->>'hasTime', 'false') = 'true'
    and coalesce((t.data->>'dur')::int, 0) > 0
    and coalesce(t.assignee, t.created_by) <> auth.uid()
    and zman_shares_group(coalesce(t.assignee, t.created_by))
    and not zman_task_visible(t.group_id, t.created_by, t.assignee, t.private);
$$;
revoke all on function zman_busy2() from public, anon;
grant execute on function zman_busy2() to authenticated;

-- ---------- התראות: לפי קבוצות (לא רק משפחת התקציב) ----------
alter table zman_notify alter column household_id drop not null;
drop policy if exists "zman notify write" on zman_notify;
drop policy if exists "zman notify update" on zman_notify;
create policy "zman notify write" on zman_notify for insert with check (created_by = auth.uid() and (to_uid = auth.uid() or zman_shares_group(to_uid)));
create policy "zman notify update" on zman_notify for update using (created_by = auth.uid()) with check (created_by = auth.uid() and (to_uid = auth.uid() or zman_shares_group(to_uid)));
alter table zman_push_subs alter column household_id drop not null;

-- עדכונים בזמן אמת
do $$ begin
  begin alter publication supabase_realtime add table zman_tasks; exception when others then null; end;
  begin alter publication supabase_realtime add table zman_members; exception when others then null; end;
end $$;
