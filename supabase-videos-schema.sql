create extension if not exists pgcrypto;

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'video',
  title text not null,
  description text not null default '',
  file_name text,
  storage_path text,
  file_url text,
  mime_type text default 'video/youtube',
  size_bytes bigint default 0,
  duration_seconds integer default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration for existing databases created before the `type` column existed:
alter table public.videos add column if not exists type text not null default 'video';
alter table public.videos alter column storage_path drop not null;
alter table public.videos alter column mime_type set default 'video/youtube';
alter table public.videos drop constraint if exists videos_type_check;
alter table public.videos add constraint videos_type_check check (type in ('photo', 'video'));

-- YouTube-only media integrity constraints.
-- Existing valid rows are preserved; invalid rows must be corrected before this block succeeds.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'videos_status_check' AND conrelid = 'public.videos'::regclass) THEN
    ALTER TABLE public.videos ADD CONSTRAINT videos_status_check CHECK (status IN ('pending', 'ready', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'videos_title_length_check' AND conrelid = 'public.videos'::regclass) THEN
    ALTER TABLE public.videos ADD CONSTRAINT videos_title_length_check CHECK (length(title) BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'videos_description_length_check' AND conrelid = 'public.videos'::regclass) THEN
    ALTER TABLE public.videos ADD CONSTRAINT videos_description_length_check CHECK (length(description) <= 5000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'videos_nonnegative_numbers_check' AND conrelid = 'public.videos'::regclass) THEN
    ALTER TABLE public.videos ADD CONSTRAINT videos_nonnegative_numbers_check CHECK (COALESCE(size_bytes, 0) >= 0 AND COALESCE(duration_seconds, 0) >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'videos_media_integrity_check' AND conrelid = 'public.videos'::regclass) THEN
    ALTER TABLE public.videos ADD CONSTRAINT videos_media_integrity_check CHECK (
      (
        type = 'photo'
        AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
        AND storage_path IS NOT NULL
        AND storage_path LIKE 'photos/%'
        AND file_url IS NOT NULL
        AND file_url LIKE '/api/videos/stream/%'
      )
      OR
      (
        type = 'video'
        AND mime_type = 'video/youtube'
        AND storage_path IS NULL
        AND file_url IS NOT NULL
        AND (
          file_url ~* '^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}([&].*)?$'
          OR file_url ~* '^https://m\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}([&].*)?$'
          OR file_url ~* '^https://youtu\.be/[A-Za-z0-9_-]{11}([?].*)?$'
          OR file_url ~* '^https://(www\.)?youtube\.com/embed/[A-Za-z0-9_-]{11}$'
        )
      )
    );
  END IF;
END
$$;
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

-- Storage policies are defined in supabase-setup.sql and use public.can_edit_library().
-- Direct video uploads are disabled; videos must use validated HTTPS YouTube URLs.
