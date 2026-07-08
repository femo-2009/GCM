-- ============================================================
-- GCM Portal — Complete Supabase Database Setup
-- Run this ENTIRE script in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 2. APP_DATA TABLE (stores global app state as JSON)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. USER_PROFILES TABLE (one row per registered user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked')),
  permissions text[] NOT NULL DEFAULT '{}',
  photo text DEFAULT NULL,
  counts jsonb NOT NULL DEFAULT '{"christians": 0, "friends": 0}'::jsonb,
  personal_plan jsonb DEFAULT NULL,
  disciples jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. TRIGGER: Auto-create user_profiles row on sign-up
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Wrapped so that any failure here (schema drift, constraint issues, etc.)
  -- never blocks account creation in auth.users. The app also creates/repairs
  -- the profile row itself via ensureUserProfile() on signup and first login,
  -- so this trigger is a best-effort convenience, not a hard dependency.
  BEGIN
    INSERT INTO public.user_profiles (
      id, email, first_name, last_name, phone
    ) VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'phone', '')
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 5. UPDATED_AT TRIGGER for both tables
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_data_set_updated_at ON public.app_data;
CREATE TRIGGER app_data_set_updated_at
  BEFORE UPDATE ON public.app_data
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS user_profiles_set_updated_at ON public.user_profiles;
CREATE TRIGGER user_profiles_set_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE public.app_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- app_data: All authenticated users can read and write
DROP POLICY IF EXISTS "Authenticated users can read app_data" ON public.app_data;
CREATE POLICY "Authenticated users can read app_data"
  ON public.app_data FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can write app_data" ON public.app_data;
CREATE POLICY "Authenticated users can write app_data"
  ON public.app_data FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- user_profiles: All authenticated users can read all profiles
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.user_profiles;
CREATE POLICY "Authenticated users can read profiles"
  ON public.user_profiles FOR SELECT TO authenticated USING (true);

-- user_profiles: All authenticated users can update any profile
DROP POLICY IF EXISTS "Authenticated users can update profiles" ON public.user_profiles;
CREATE POLICY "Authenticated users can update profiles"
  ON public.user_profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- user_profiles: Allow insert (trigger uses SECURITY DEFINER, but also allow direct)
DROP POLICY IF EXISTS "Trigger can insert profiles" ON public.user_profiles;
CREATE POLICY "Trigger can insert profiles"
  ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- 7. STORAGE BUCKET: media (for videos and photos)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', true, 2147483648)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2147483648;

-- Storage policies
DROP POLICY IF EXISTS "Authenticated users can upload media" ON storage.objects;
CREATE POLICY "Authenticated users can upload media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media');

DROP POLICY IF EXISTS "Public can read media" ON storage.objects;
CREATE POLICY "Public can read media"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'media');

DROP POLICY IF EXISTS "Authenticated users can update media" ON storage.objects;
CREATE POLICY "Authenticated users can update media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media');

DROP POLICY IF EXISTS "Authenticated users can delete media" ON storage.objects;
CREATE POLICY "Authenticated users can delete media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media');

-- ============================================================
-- 8. SEED: Initial app_data record
-- ============================================================
INSERT INTO public.app_data (key, value)
VALUES (
  'portal_app_data',
  '{
    "leaders": [],
    "groups": [],
    "library": [],
    "homeConfig": {
      "welcomeMessageAr": "مرحباً بكم في موقع GCM",
      "welcomeMessageEn": "Welcome to the GCM Portal",
      "planPhoto": "",
      "planTextAr": "أضف نص الخطة العامة من هنا...",
      "planTextEn": "Add the general plan text here..."
    }
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 9. AFTER SIGNING UP — Make yourself Super Admin
-- Replace YOUR_EMAIL with your actual email and run this:
--
-- UPDATE public.user_profiles
-- SET role = 'super_admin', status = 'approved'
-- WHERE email = 'YOUR_EMAIL@example.com';
--
-- ============================================================
