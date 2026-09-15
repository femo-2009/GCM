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
-- 4. APPROVED USER CHECK FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_approved_user()
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
  );
$function$;

-- ============================================================
-- 5. APPROVED ADMIN CHECK FUNCTION
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
-- 6. AUTO-CREATE USER PROFILE AFTER SIGN-UP
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

DROP TRIGGER IF EXISTS on_auth_user_created
ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 7. UPDATED_AT FUNCTIONS AND TRIGGERS
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
-- 8. ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.app_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. APP_DATA POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read app_data"
ON public.app_data;

DROP POLICY IF EXISTS "Authenticated users can write app_data"
ON public.app_data;

DROP POLICY IF EXISTS "Approved users can read app_data"
ON public.app_data;

DROP POLICY IF EXISTS "Approved admins can insert app_data"
ON public.app_data;

DROP POLICY IF EXISTS "Approved admins can update app_data"
ON public.app_data;

DROP POLICY IF EXISTS "Approved admins can delete app_data"
ON public.app_data;

DROP POLICY IF EXISTS "Service role full access app_data"
ON public.app_data;

CREATE POLICY "Approved users can read app_data"
ON public.app_data
FOR SELECT
TO authenticated
USING (public.is_approved_user());

CREATE POLICY "Approved admins can insert app_data"
ON public.app_data
FOR INSERT
TO authenticated
WITH CHECK (public.is_approved_admin());

CREATE POLICY "Approved admins can update app_data"
ON public.app_data
FOR UPDATE
TO authenticated
USING (public.is_approved_admin())
WITH CHECK (public.is_approved_admin());

CREATE POLICY "Approved admins can delete app_data"
ON public.app_data
FOR DELETE
TO authenticated
USING (public.is_approved_admin());

-- ============================================================
-- 10. USER_PROFILES POLICIES
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

-- There are intentionally no INSERT, UPDATE, DELETE,
-- or ALL policies for anon or authenticated users.
--
-- New profiles are created by the SECURITY DEFINER trigger.
-- Administrative profile changes are handled by the protected server.

-- ============================================================
-- 11. REMOVE EXCESSIVE DIRECT USER_PROFILES PRIVILEGES
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
-- 12. REMOVE EXCESSIVE DIRECT APP_DATA PRIVILEGES
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.app_data
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.app_data
FROM authenticated;

GRANT SELECT
ON TABLE public.app_data
TO authenticated;

-- ============================================================
-- 13. RESTRICT FUNCTION EXECUTION
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.is_approved_user()
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public.is_approved_user()
FROM anon;

GRANT EXECUTE
ON FUNCTION public.is_approved_user()
TO authenticated;

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
-- 14. STORAGE BUCKET
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
-- 15. INITIAL APP DATA
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
-- 16. MANUAL SUPER ADMIN SETUP
--
-- Replace YOUR_EMAIL with your real email only when needed.
-- Run this command manually and only for your own account.
--
-- UPDATE public.user_profiles
-- SET role = 'super_admin',
--     status = 'approved'
-- WHERE email = 'YOUR_EMAIL@example.com';
-- ============================================================
