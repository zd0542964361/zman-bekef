-- זמן בכיף — ⭐ פרסים: גם ילדים בקבוצה רואים את רשימת הפרסים (שאר הדברים של הקבוצה נשארים מוסתרים מהם)
drop policy if exists "zt read prizes" on zman_tasks;
create policy "zt read prizes" on zman_tasks for select using (group_id is not null and not deleted and data->>'kind' = 'prize' and zman_in_group(group_id));
