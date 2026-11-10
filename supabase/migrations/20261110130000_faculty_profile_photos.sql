-- Faculty profile photos for directory cards.

alter table public.profiles
  add column if not exists photo_path text;

alter table public.profiles
  drop constraint if exists profiles_photo_path_len;

alter table public.profiles
  add constraint profiles_photo_path_len
  check (photo_path is null or char_length(photo_path) <= 240);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_photos_upload on storage.objects;
create policy profile_photos_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'profile-photos'
  and owner_id = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
  and exists (select 1 from public.profiles where id = (select auth.uid()) and active and role = 'faculty')
);

drop policy if exists profile_photos_update on storage.objects;
create policy profile_photos_update on storage.objects for update to authenticated using (
  bucket_id = 'profile-photos'
  and owner_id = (select auth.uid())::text
  and exists (select 1 from public.profiles where id = (select auth.uid()) and active and role = 'faculty')
) with check (
  bucket_id = 'profile-photos'
  and owner_id = (select auth.uid())::text
);

drop policy if exists profile_photos_delete on storage.objects;
create policy profile_photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'profile-photos'
  and owner_id = (select auth.uid())::text
  and exists (select 1 from public.profiles where id = (select auth.uid()) and active and role = 'faculty')
);

drop policy if exists profile_photos_read on storage.objects;
create policy profile_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'profile-photos'
  and exists (
    select 1 from public.profiles viewer
    join public.profiles owner_profile
      on owner_profile.id::text = split_part(objects.name, '/', 1)
    where viewer.id = (select auth.uid())
      and viewer.active
      and owner_profile.active
      and owner_profile.role = 'faculty'
      and viewer.institution_id = owner_profile.institution_id
  )
);

create or replace function public.set_faculty_photo(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'faculty') then
    raise exception 'Faculty access required';
  end if;
  if clean is null then
    update public.profiles set photo_path = null where id = auth.uid();
    return;
  end if;
  if clean !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then
    raise exception 'Photo unavailable';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'profile-photos'
      and name = clean
      and owner_id = auth.uid()::text
  ) then
    raise exception 'Upload the photo first';
  end if;
  update public.profiles set photo_path = clean where id = auth.uid();
end;
$$;

revoke all on function public.set_faculty_photo(text) from public, anon;
grant execute on function public.set_faculty_photo(text) to authenticated;
