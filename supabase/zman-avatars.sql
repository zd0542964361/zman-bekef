-- זמן בכיף — 🖼️ תמונת פרופיל (20.10.2026)
-- תיקייה פרטית "avatars": כל אחד מעלה רק לתיקייה שלו (<uid>/avatar.jpg), ורק מי שבקבוצה איתו רואה.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 300000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "avatars read" on storage.objects;
drop policy if exists "avatars insert" on storage.objects;
drop policy if exists "avatars update" on storage.objects;
drop policy if exists "avatars delete" on storage.objects;
create policy "avatars read" on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text
    or zman_shares_group(((storage.foldername(name))[1])::uuid)));
create policy "avatars insert" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars update" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars delete" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- בפרופיל: מתי הועלתה התמונה (null = אין תמונה, מציגים אימוג'י)
alter table zman_profiles add column if not exists photo text;
