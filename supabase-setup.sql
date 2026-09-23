-- ============================================================
-- GCM Portal — Complete Supabase Database Setup
-- Secure baseline version
-- Run this script in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ============================================================
-- 1. REQUIRED EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 2. SECURITY RATE LIMITS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.security_rate_limits (
  rate_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
ON TABLE public.security_rate_limits
FROM PUBLIC;

REVOKE ALL PRIVILEGES
ON TABLE public.security_rate_limits
FROM anon;

REVOKE ALL PRIVILEGES
ON TABLE public.security_rate_limits
FROM authenticated;

GRANT ALL PRIVILEGES
ON TABLE public.security_rate_limits
TO service_role;

-- ============================================================
-- 3. APP_DATA TABLE
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
-- 5. RATE LIMIT FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_security_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  current_count integer;
  current_window timestamptz;
  allowed boolean;
BEGIN
  IF p_rate_key IS NULL
     OR length(p_rate_key) < 3
     OR length(p_rate_key) > 200
     OR p_limit < 1
     OR p_window_seconds < 1 THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0
    );
  END IF;

  INSERT INTO public.security_rate_limits (
    rate_key,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (
    p_rate_key,
    now(),
    1,
    now()
  )
  ON CONFLICT (rate_key)
  DO UPDATE SET
    request_count = CASE
      WHEN public.security_rate_limits.window_started_at
           <= now() - make_interval(secs => p_window_seconds)
      THEN 1
      ELSE public.security_rate_limits.request_count + 1
    END,
    window_started_at = CASE
      WHEN public.security_rate_limits.window_started_at
           <= now() - make_interval(secs => p_window_seconds)
      THEN now()
      ELSE public.security_rate_limits.window_started_at
    END,
    updated_at = now()
  RETURNING
    request_count,
    window_started_at
  INTO
    current_count,
    current_window;

  allowed := current_count <= p_limit;

  RETURN jsonb_build_object(
    'allowed', allowed,
    'remaining', GREATEST(p_limit - current_count, 0),
    'count', current_count,
    'window_started_at', current_window
  );
END;
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.check_security_rate_limit(text, integer, integer)
FROM PUBLIC;

REVOKE ALL PRIVILEGES
ON FUNCTION public.check_security_rate_limit(text, integer, integer)
FROM anon;

REVOKE ALL PRIVILEGES
ON FUNCTION public.check_security_rate_limit(text, integer, integer)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.check_security_rate_limit(text, integer, integer)
TO service_role;

-- ============================================================
-- 6. MFA ASSURANCE CHECK FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT COALESCE((auth.jwt() ->> 'aal') = 'aal2', false);
$function$;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_aal2() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_aal2() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated;

-- ============================================================
-- 7. APPROVED USER CHECK FUNCTION
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
      AND public.is_aal2()
  );
$function$;

-- ============================================================
-- 6. LIBRARY EDITOR CHECK FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_edit_library()
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
      AND public.is_aal2()
      AND (
        role = 'super_admin'
        OR 'edit_library' = ANY (permissions)
      )
  );
$function$;

-- ============================================================
-- 7. AUTO-CREATE USER PROFILE AFTER SIGN-UP
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
    RAISE WARNING
      'handle_new_user failed for user %: %',
      NEW.id,
      SQLERRM;

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
-- 8. UPDATED_AT FUNCTION AND TRIGGERS
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
-- 9. ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.app_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 10. APP_DATA POLICIES
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
USING (
  public.is_approved_user()
);

CREATE POLICY "Approved admins can insert app_data"
ON public.app_data
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_approved_admin()
);

CREATE POLICY "Approved admins can update app_data"
ON public.app_data
FOR UPDATE
TO authenticated
USING (
  public.is_approved_admin()
)
WITH CHECK (
  public.is_approved_admin()
);

CREATE POLICY "Approved admins can delete app_data"
ON public.app_data
FOR DELETE
TO authenticated
USING (
  public.is_approved_admin()
);

-- ============================================================
-- 11. USER_PROFILES POLICIES
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
USING (
  id = auth.uid()
);

CREATE POLICY "Approved admins can read all profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (
  public.is_approved_admin()
);

-- There are intentionally no INSERT, UPDATE, DELETE,
-- or ALL policies for anon or authenticated users.
--
-- New profiles are created by the SECURITY DEFINER trigger.
-- Administrative profile changes are performed by the protected server.

-- ============================================================
-- 12. REMOVE EXCESSIVE USER_PROFILES PRIVILEGES
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
-- 13. REMOVE EXCESSIVE APP_DATA PRIVILEGES
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
-- 14. FUNCTION EXECUTION PRIVILEGES
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

REVOKE EXECUTE
ON FUNCTION public.can_edit_library()
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public.can_edit_library()
FROM anon;

GRANT EXECUTE
ON FUNCTION public.can_edit_library()
TO authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_aal2() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_aal2() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated;

-- ============================================================
-- 15. PRIVATE STORAGE BUCKET
-- ============================================================

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'media',
  'media',
  false,
  2147483648,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
ON CONFLICT (id)
DO UPDATE SET
  public = false,
  file_size_limit = 2147483648,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[];

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'leader-media',
  'leader-media',
  true,
  5242880,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
ON CONFLICT (id)
DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[];

-- ============================================================
-- 16. STORAGE POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can upload media"
ON storage.objects;

DROP POLICY IF EXISTS "Public can read media"
ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can update media"
ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can delete media"
ON storage.objects;

DROP POLICY IF EXISTS "media_select_approved_users"
ON storage.objects;

DROP POLICY IF EXISTS "media_insert_library_editors"
ON storage.objects;

DROP POLICY IF EXISTS "media_update_library_editors"
ON storage.objects;

DROP POLICY IF EXISTS "media_delete_library_editors"
ON storage.objects;

CREATE POLICY "media_select_approved_users"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'media'
  AND public.is_approved_user()
);

CREATE POLICY "media_insert_library_editors"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND public.can_edit_library()
);

CREATE POLICY "media_update_library_editors"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND public.can_edit_library()
)
WITH CHECK (
  bucket_id = 'media'
  AND public.can_edit_library()
);

CREATE POLICY "media_delete_library_editors"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND public.can_edit_library()
);

-- Leader-media policies: only approved users can read, only home editors (super_admin/edit_home + aal2) can write via service_role worker (storage RLS via is_approved_admin)
DROP POLICY IF EXISTS "leader_media_select_approved_users" ON storage.objects;
DROP POLICY IF EXISTS "leader_media_insert_home_editors" ON storage.objects;
DROP POLICY IF EXISTS "leader_media_update_home_editors" ON storage.objects;
DROP POLICY IF EXISTS "leader_media_delete_home_editors" ON storage.objects;

CREATE POLICY "leader_media_select_approved_users"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'leader-media'
  AND public.is_approved_user()
);

CREATE POLICY "leader_media_insert_home_editors"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'leader-media'
  AND public.is_approved_admin()
);

CREATE POLICY "leader_media_update_home_editors"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'leader-media'
  AND public.is_approved_admin()
)
WITH CHECK (
  bucket_id = 'leader-media'
  AND public.is_approved_admin()
);

CREATE POLICY "leader_media_delete_home_editors"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'leader-media'
  AND public.is_approved_admin()
);

-- Do not remove SELECT, INSERT, UPDATE, or DELETE
-- from authenticated on storage.objects.
--
-- The frontend uploads directly through Supabase Storage.
-- Storage RLS Policies above control the actual access.
--
-- Supabase may keep base privileges on storage.objects.
-- The absence of anon Policies and the private Bucket
-- are the important security controls.

-- ============================================================
-- 17. INITIAL APP DATA
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
-- 18. MANUAL SUPER ADMIN SETUP
--
-- Replace YOUR_EMAIL with your real email only when needed.
-- Run this command manually and only for your own account.
--
-- UPDATE public.user_profiles
-- SET role = 'super_admin',
--     status = 'approved'
-- WHERE email = 'YOUR_EMAIL@example.com';
-- ============================================================
