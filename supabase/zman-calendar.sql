-- זמן בכיף — יומן: "מי רואה את היומן שלי" (לכל חבר בכל קבוצה) + יומן של אדם אחר לפי ההרשאה.
-- רק מוסיף; לא נוגע בשום דבר קיים.
alter table zman_members add column if not exists cal_share text check (cal_share in ('all', 'busy', 'none'));

-- ההרשאה בפועל: מה שהאדם בחר, ואם לא בחר — במשפחה ובקשר ישיר "הכל", בשאר הקבוצות "רק תפוס"
create or replace function zman_cal_level(target uuid) returns text
language sql security definer stable set search_path = public as $$
  select case max(case coalesce(b.cal_share, case when g.kind in ('family', 'pair') then 'all' else 'busy' end) when 'all' then 2 when 'busy' then 1 else 0 end)
           when 2 then 'all' when 1 then 'busy' else 'none' end
  from zman_members a
  join zman_members b on b.group_id = a.group_id and b.user_id = target
  join zman_groups g on g.id = a.group_id
  where a.user_id = auth.uid() and a.role <> 'child' and target <> auth.uid();
$$;

create or replace function zman_set_cal_share(g uuid, v text)
returns void language sql security definer set search_path = public as $$
  update zman_members set cal_share = v where group_id = g and user_id = auth.uid() and v in ('all', 'busy', 'none');
$$;

-- היומן של אדם אחר: פרטי / "רק תפוס" → רק זמן, בלי טקסט
create or replace function zman_calendar(target uuid)
returns table (id text, busy boolean, data jsonb)
language sql security definer stable set search_path = public as $$
  with lv as (select zman_cal_level(target) l)
  select t.id,
         (lv.l = 'busy' or t.private) as busy,
         case when lv.l = 'all' and not t.private then t.data
              else jsonb_build_object('due', t.data->'due', 'hasTime', t.data->'hasTime', 'dur', t.data->'dur', 'repeat', t.data->'repeat',
                                      'status', t.data->'status', 'kind', 'task', 'text', 'תפוס/ה') end
  from zman_tasks t, lv
  where lv.l in ('all', 'busy') and not t.deleted
    and coalesce(t.assignee, t.created_by) = target
    and t.data->>'due' is not null
    and coalesce(t.data->>'kind', '') not in ('msg', 'reply')
    and (t.data->>'status' = 'open' or coalesce(t.data->>'doneAt', t.data->>'due') > (now() - interval '120 days')::text)
  limit 3000;
$$;
revoke all on function zman_cal_level(uuid) from public, anon;
revoke all on function zman_set_cal_share(uuid, text) from public, anon;
revoke all on function zman_calendar(uuid) from public, anon;
grant execute on function zman_cal_level(uuid) to authenticated;
grant execute on function zman_set_cal_share(uuid, text) to authenticated;
grant execute on function zman_calendar(uuid) to authenticated;
