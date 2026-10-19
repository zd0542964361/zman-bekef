-- זמן בכיף — צבע לכל בן משפחה (לכל חבר בקבוצה). כל אחד משנה את שלו; מנהל משנה גם ל"רק שם".
alter table zman_members add column if not exists color text check (color ~ '^#[0-9A-Fa-f]{6}$');
create or replace function zman_set_color(mid text, c text)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid; u uuid;
begin
  select group_id, user_id into g, u from zman_members where id = mid;
  if g is null then raise exception 'not found'; end if;
  if u is distinct from auth.uid() and zman_group_role(g) is distinct from 'admin' then raise exception 'not allowed'; end if;
  if c is not null and c !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'bad color'; end if;
  -- אותו צבע בכל הקבוצות שלו (אם זה משתמש עם חשבון)
  if u is not null then update zman_members set color = c where user_id = u and (u = auth.uid() or group_id = g);
  else update zman_members set color = c where id = mid; end if;
end $$;
revoke all on function zman_set_color(text, text) from public, anon;
grant execute on function zman_set_color(text, text) to authenticated;
