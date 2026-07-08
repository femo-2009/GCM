create extension if not exists pgcrypto;

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'video',
  title text not null,
  description text not null default '',
  file_name text,
  storage_path text,
  file_url text,
  mime_type text default 'video/mp4',
  size_bytes bigint default 0,
  duration_seconds integer default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration for existing databases created before the `type` column existed:
alter table public.videos add column if not exists type text not null default 'video';
alter table public.videos alter column storage_path drop not null;
alter table public.videos drop constraint if exists videos_type_check;
alter table public.videos add constraint videos_type_check check (type in ('photo', 'video'));

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at
before update on public.videos
for each row
execute function public.set_updated_at();

-- Storage bucket policy example (replace with your actual bucket name if needed)
-- This is the SQL pattern to use in Supabase SQL Editor:
--
-- create policy "Admins can upload videos"
-- on storage.objects for insert
-- to authenticated
-- with check (
--   bucket_id = 'videos' and
--   (auth.jwt() ->> 'role') = 'admin'
-- );
--
-- create policy "Admins can update videos"
-- on storage.objects for update
-- to authenticated
-- using (
--   bucket_id = 'videos' and
--   (auth.jwt() ->> 'role') = 'admin'
-- );
--
-- create policy "Admins can delete videos"
-- on storage.objects for delete
-- to authenticated
-- using (
--   bucket_id = 'videos' and
--   (auth.jwt() ->> 'role') = 'admin'
-- );
--
-- create policy "Authenticated users can read videos"
-- on storage.objects for select
-- to authenticated
-- using (bucket_id = 'videos');
--
-- create policy "Admins can manage videos table"
-- on public.videos for all
-- to authenticated
-- using ((auth.jwt() ->> 'role') = 'admin')
-- with check ((auth.jwt() ->> 'role') = 'admin');
