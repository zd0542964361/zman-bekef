-- זמן בכיף — 🔄 החלפת קודי הצטרפות (20.10.2026)
-- מנהל הקבוצה מחליף את הקוד (וקוד הילד). הקוד הישן, הקישור הישן וה-QR הישן מפסיקים לעבוד מיד.
create or replace function zman_rotate_codes(g uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if zman_group_role(g) is distinct from 'admin' then raise exception 'not admin'; end if;
  update zman_groups set code = zman_new_code(),
    child_code = case when child_code is null then null else zman_new_code() end
  where id = g;
end $$;
revoke all on function zman_rotate_codes(uuid) from public, anon;
grant execute on function zman_rotate_codes(uuid) to authenticated;
