-- זמן בכיף — קטגוריות (שם, אייקון, צבע). שייכות לקבוצה (כולם בקבוצה רואים ועורכים) או "רק שלי" (group_id ריק).
-- קטגוריה מוכנה (בית, עבודה…) שמישהו שינה נשמרת כשורה עם builtin = המפתח שלה.
create table if not exists zman_categories (
  id text primary key,
  group_id uuid references zman_groups(id) on delete cascade,
  owner uuid not null default auth.uid(),
  builtin text,
  name text not null check (char_length(name) between 1 and 30),
  icon text check (char_length(icon) <= 16),
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
drop trigger if exists zman_categories_touch on zman_categories;
create trigger zman_categories_touch before insert or update on zman_categories for each row execute function touch_updated();
alter table zman_categories enable row level security;
drop policy if exists "zc read" on zman_categories;
drop policy if exists "zc insert" on zman_categories;
drop policy if exists "zc update" on zman_categories;
create policy "zc read" on zman_categories for select using ((group_id is null and owner = auth.uid()) or (group_id is not null and zman_in_group(group_id)));
create policy "zc insert" on zman_categories for insert with check (owner = auth.uid() and (group_id is null or zman_in_group(group_id)));
create policy "zc update" on zman_categories for update using ((group_id is null and owner = auth.uid()) or (group_id is not null and zman_in_group(group_id)))
  with check ((group_id is null and owner = auth.uid()) or (group_id is not null and zman_in_group(group_id)));
grant select, insert, update on zman_categories to authenticated;
do $$ begin begin alter publication supabase_realtime add table zman_categories; exception when others then null; end; end $$;

-- 20.10.2026: סדר הקטגוריות (גרירה למעלה/למטה) — גם לקטגוריות המוכנות
alter table zman_categories add column if not exists ord integer;
