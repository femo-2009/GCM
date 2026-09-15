-- ============================================================
-- GCM Portal — Complete Supabase Database Setup
-- Secure baseline version
-- Run this script in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 2. APP_DATA TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. USER_PROFILES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin', 'super_admin')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'blocked')),
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
-- 4. SECURE ADMIN CHECK FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_approved_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND status = 'approved'
      AND role IN ('admin', 'super_admin')
  );
$function$;

-- ============================================================
-- 5. AUTO-CREATE USER PROFILE AFTER SIGN-UP
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    email,
    first_name,
    last_name,
    phone
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 6. UPDATED_AT FUNCTIONS AND TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS app_data_set_updated_at
ON public.app_data;

CREATE TRIGGER app_data_set_updated_at
BEFORE UPDATE ON public.app_data
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS user_profiles_set_updated_at
ON public.user_profiles;

CREATE TRIGGER user_profiles_set_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 7. ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.app_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. APP_DATA POLICIES
--
-- These policies are intentionally kept unchanged for now.
-- They will be hardened in a later security step.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read app_data"
ON public.app_data;

CREATE POLICY "Authenticated users can read app_data"
ON public.app_data
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can write app_data"
ON public.app_data;

CREATE POLICY "Authenticated users can write app_data"
ON public.app_data
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ============================================================
-- 9. SECURE USER_PROFILES POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read profiles"
ON public.user_profiles;

DROP POLICY IF EXISTS "Approved admins can read all profiles"
ON public.user_profiles;

DROP POLICY IF EXISTS "Users can read own profile"
ON public.user_profiles;

DROP POLICY IF EXISTS "Authenticated users can update profiles"
ON public.user_profiles;

DROP POLICY IF EXISTS "Trigger can insert profiles"
ON public.user_profiles;

DROP POLICY IF EXISTS "Authenticated users can insert profiles"
ON public.user_profiles;

DROP POLICY IF EXISTS "Authenticated users can delete profiles"
ON public.user_profiles;

CREATE POLICY "Users can read own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Approved admins can read all profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (public.is_approved_admin());

-- No INSERT, UPDATE, DELETE, or ALL policies are granted
-- to anon or authenticated users on user_profiles.
--
-- Profile creation is performed by the SECURITY DEFINER trigger.
-- Administrative profile changes are performed by the protected server.

-- ============================================================
-- 10. REMOVE EXCESSIVE DIRECT TABLE PRIVILEGES
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.user_profiles
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.user_profiles
FROM authenticated;

GRANT SELECT
ON TABLE public.user_profiles
TO authenticated;

-- ============================================================
-- 11. RESTRICT ADMIN FUNCTION EXECUTION
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.is_approved_admin()
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public.is_approved_admin()
FROM anon;

GRANT EXECUTE
ON FUNCTION public.is_approved_admin()
TO authenticated;

-- ============================================================
-- 12. STORAGE BUCKET
--
-- Storage policies will be hardened in a later security step.
-- ============================================================

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
VALUES (
  'media',
  'media',
  true,
  2147483648
)
ON CONFLICT (id)
DO UPDATE SET
  public = true,
  file_size_limit = 2147483648;

DROP POLICY IF EXISTS "Authenticated users can upload media"
ON storage.objects;

CREATE POLICY "Authenticated users can upload media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media');

DROP POLICY IF EXISTS "Public can read media"
ON storage.objects;

CREATE POLICY "Public can read media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'media');

DROP POLICY IF EXISTS "Authenticated users can update media"
ON storage.objects;

CREATE POLICY "Authenticated users can update media"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'media');

DROP POLICY IF EXISTS "Authenticated users can delete media"
ON storage.objects;

CREATE POLICY "Authenticated users can delete media"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'media');

-- ============================================================
-- 13. INITIAL APP DATA
-- ============================================================

INSERT INTO public.app_data (
  key,
  value
)
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
-- 14. MANUAL SUPER ADMIN SETUP
--
-- Replace YOUR_EMAIL with your real email only when needed.
-- Run this command manually and only for your own account:
--
-- UPDATE public.user_profiles
-- SET role = 'super_admin',
--     status = 'approved'
-- WHERE email = 'YOUR_EMAIL@example.com';
-- ============================================================
