import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createSupabaseClient, type SupabaseEnv } from './src/lib/supabase-server';

type Env = {
  Bindings: SupabaseEnv & {
    ASSETS: { fetch: (request: Request) => Promise<Response> };
  };
};

const app = new Hono<Env>();
const RATE_LIMITS = {
  signup: { limit: 10, windowSeconds: 3600 },
  admin: { limit: 60, windowSeconds: 60 },
  mediaRegister: { limit: 10, windowSeconds: 3600 },
  profileMedia: { limit: 30, windowSeconds: 3600 },
};

function decodeVerifiedJwtPayload(token: string): Record<string, any> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function requestClientKey(c: any): string {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown-ip';
  return ip.slice(0, 100);
}

async function enforceRateLimit(supabase: any, c: any, scope: string, limit: number, windowSeconds: number, identity = ''): Promise<Response | null> {
  const safeIdentity = String(identity).trim().toLowerCase().slice(0, 160);
  const rateKey = `worker:${scope}:${requestClientKey(c)}:${safeIdentity}`;
  const { data, error } = await supabase.rpc('check_security_rate_limit', {
    p_rate_key: rateKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || !data?.allowed) {
    const response = c.json({ error: 'Too many requests. Please try again later.', code: 'rate_limited' }, 429);
    response.headers.set('Retry-After', String(windowSeconds));
    return response;
  }
  return null;
}


app.use(
  '*',
  cors({
    origin: 'https://gcm.afraimfarag7.workers.dev',
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
app.use('*', async (c, next) => {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  c.header(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
});

// Auth middleware
const authenticateUser = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - No token provided' }, 401);
  }
  const token = authHeader.substring(7);
  const supabase = createSupabaseClient(c.env);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return c.json({ error: 'Unauthorized - Invalid token' }, 401);
  }
  const profile = await ensureUserProfile(supabase, user);
  if (!profile || profile.status !== 'approved') {
    return c.json({ error: 'Forbidden - Account is not approved' }, 403);
  }

  // getUser() has already verified this JWT with Supabase. Decode the verified
  // payload only to enforce the MFA assurance claim for administrators.
  const claims = decodeVerifiedJwtPayload(token);
  const isAdmin = profile.role === 'admin' || profile.role === 'super_admin';
  if (isAdmin && claims?.aal !== 'aal2') {
    return c.json({ error: 'Forbidden - Administrator MFA verification required', code: 'mfa_required' }, 403);
  }
  c.set('aal', claims?.aal || 'aal1');
  c.set('user', profile);
  await next();
};

// Authenticated users may read their own profile before admin approval.
// Other application data remains protected by authenticateUser below.
const authenticateAnyUser = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - No token provided' }, 401);
  }
  const token = authHeader.substring(7);
  const supabase = createSupabaseClient(c.env);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return c.json({ error: 'Unauthorized - Invalid token' }, 401);
  }
  const profile = await ensureUserProfile(supabase, user);
  if (!profile) {
    return c.json({ error: 'Profile not found' }, 404);
  }
  c.set('user', profile);
  await next();
};

// Ensure user profile exists
async function ensureUserProfile(supabase: any, authUser: any, overrides: Record<string, any> = {}) {
  const metadata = authUser.user_metadata || {};
  const profileSeed = {
    id: authUser.id,
    email: authUser.email || '',
    first_name: metadata.first_name || '',
    last_name: metadata.last_name || '',
    phone: metadata.phone || authUser.phone || '',
    photo: metadata.photo || null,
    ...overrides,
  };

  const { data: existingProfile } = await supabase
    .from('user_profiles').select('*').eq('id', authUser.id).maybeSingle();

  if (existingProfile) {
    const updates: Record<string, any> = {};
    if (!existingProfile.email && profileSeed.email) updates.email = profileSeed.email;
    if (!existingProfile.first_name && profileSeed.first_name) updates.first_name = profileSeed.first_name;
    if (!existingProfile.last_name && profileSeed.last_name) updates.last_name = profileSeed.last_name;
    if (!existingProfile.phone && profileSeed.phone) updates.phone = profileSeed.phone;
    if (!existingProfile.photo && profileSeed.photo) updates.photo = profileSeed.photo;
    if (Object.keys(updates).length === 0) return existingProfile;
    const { data: updatedProfile } = await supabase.from('user_profiles').update(updates).eq('id', authUser.id).select('*').single();
    return updatedProfile;
  }

  const { data: createdProfile } = await supabase.from('user_profiles').insert({
    ...profileSeed, role: 'user', status: 'pending', permissions: [],
    counts: { christians: 0, friends: 0 }, disciples: [], user_groups: [],
  }).select('*').single();

  return createdProfile;
}

// Helper: fetch app_data from Supabase
async function getAppData(supabase: any) {
  const { data } = await supabase.from('app_data').select('value').eq('key', 'portal_app_data').maybeSingle();
  return data?.value || {};
}

// Helper: save app_data to Supabase
async function saveAppData(supabase: any, value: any) {
  const { error } = await supabase.from('app_data').upsert({ key: 'portal_app_data', value }, { onConflict: 'key' });
  if (error) throw error;
}

async function writeAuditLog(supabase: any, c: any, actorId: string | null, action: string, targetType: string | null, targetId: string | null, metadata: Record<string, any> = {}) {
  const { error } = await supabase.from('security_audit_logs').insert({
    actor_id: actorId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
    ip_address: c.req.header('CF-Connecting-IP') || null,
    user_agent: (c.req.header('User-Agent') || '').slice(0, 500) || null,
  });
  if (error) console.error('Audit log write failed:', error.message);
}

// Canonical phone format for this Egyptian-only portal: 01XXXXXXXXX.
function normalizeEgyptianPhone(value: unknown): string {
  let phone = String(value ?? '').trim().replace(/[\s().-]/g, '');
  if (phone.startsWith('+20')) phone = '0' + phone.slice(3);
  else if (phone.startsWith('20')) phone = '0' + phone.slice(2);
  return phone;
}

function isValidEgyptianPhone(phone: string): boolean {
  return /^01[0125][0-9]{8}$/.test(phone);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

app.use('/api/admin/*', async (c, next) => {
  const supabase = createSupabaseClient(c.env);
  const limited = await enforceRateLimit(supabase, c, 'admin', RATE_LIMITS.admin.limit, RATE_LIMITS.admin.windowSeconds);
  if (limited) return limited;
  await next();
});

app.use('/api/videos/register', async (c, next) => {
  const supabase = createSupabaseClient(c.env);
  const limited = await enforceRateLimit(supabase, c, 'media-register', RATE_LIMITS.mediaRegister.limit, RATE_LIMITS.mediaRegister.windowSeconds);
  if (limited) return limited;
  await next();
});

app.use('/api/profile-media/*', async (c, next) => {
  const supabase = createSupabaseClient(c.env);
  const limited = await enforceRateLimit(supabase, c, 'profile-media', RATE_LIMITS.profileMedia.limit, RATE_LIMITS.profileMedia.windowSeconds);
  if (limited) return limited;
  await next();
});

// Auth routes
app.post('/api/auth/signup', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const { email = '', password = '', firstName = '', lastName = '', phone = '', photo = '' } = await c.req.json();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedFirstName = String(firstName).trim();
    const normalizedLastName = String(lastName).trim();
    const normalizedPhone = normalizeEgyptianPhone(phone);
    const signupLimitResponse = await enforceRateLimit(supabase, c, 'signup', RATE_LIMITS.signup.limit, RATE_LIMITS.signup.windowSeconds, normalizedEmail);
    if (signupLimitResponse) return signupLimitResponse;

    if (!normalizedEmail || !password || !normalizedFirstName || !normalizedLastName || !normalizedPhone) {
      return c.json({ error: 'All required signup fields must be provided.' }, 400);
    }
    if (!isValidEmail(normalizedEmail)) {
      return c.json({ error: 'Please enter a valid email address.', code: 'invalid_email' }, 400);
    }
    if (normalizedFirstName.length < 2 || normalizedFirstName.length > 60 || normalizedLastName.length < 2 || normalizedLastName.length > 60) {
      return c.json({ error: 'Names must be between 2 and 60 characters.', code: 'invalid_name' }, 400);
    }
    if (String(password).length < 8) {
      return c.json({ error: 'Password must be at least 8 characters long.', code: 'weak_password' }, 400);
    }
    if (!isValidEgyptianPhone(normalizedPhone)) {
      return c.json({ error: 'Please enter a valid Egyptian mobile number, for example 01012345678.', code: 'invalid_phone' }, 400);
    }

    const { data: blockedMatches } = await supabase.from('user_profiles')
      .select('id').eq('status', 'blocked')
      .or(`email.eq.${normalizedEmail}${normalizedPhone ? `,phone.eq.${normalizedPhone}` : ''}`);
    if (blockedMatches && blockedMatches.length > 0) {
      return c.json({ error: 'This email or phone number has been blocked by the administrator.', code: 'blocked' }, 403);
    }

    if (normalizedPhone) {
      const { data: phoneMatches, error: phoneLookupError } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('phone', normalizedPhone)
        .limit(1);
      if (phoneLookupError) throw phoneLookupError;
      if (phoneMatches && phoneMatches.length > 0) {
        return c.json({
          error: 'This phone number is already registered. Please use a different number.',
          code: 'phone_exists',
        }, 409);
      }
    }

    const { data: createdUserData, error: createUserError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: String(password),
      options: {
        data: {
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          phone: normalizedPhone,
        },
      },
    });
    if (createUserError || !createdUserData?.user) {
      const message =
        createUserError?.message && createUserError.message !== '{}'
      ? createUserError.message
      : JSON.stringify({
        name: createUserError?.name,
        status: createUserError?.status,
        code: createUserError?.code,
      });

      const emailExists = /already|exists|registered/i.test(message);
      const statusCode = emailExists ? 409 : 400;
      return c.json({
        error: emailExists ? 'This email address is already registered.' : 'Unable to create account.',
        code: emailExists ? 'email_exists' : 'signup_failed',
      }, statusCode);
    }

    try {
      const profile = await ensureUserProfile(supabase, createdUserData.user, { photo: photo || null, phone: normalizedPhone });
      if (!profile) throw new Error('Failed to create user profile');
      return c.json({ profile }, 201);
    } catch (profileError: any) {
      // Avoid leaving an Auth account without its profile when the unique phone
      // index rejects a concurrent duplicate signup.
      await supabase.auth.admin.deleteUser(createdUserData.user.id);
      const message = String(profileError?.message || 'Failed to create user profile');
      if (/duplicate|unique|user_profiles_phone_unique_idx/i.test(message)) {
        return c.json({
          error: 'This phone number is already registered. Please use a different number.',
          code: 'phone_exists',
        }, 409);
      }
      throw profileError;
    }
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create account' }, 500);
  }
});

app.get('/api/auth/profile', authenticateAnyUser, async (c) => {
  const supabase = createSupabaseClient(c.env);
  return c.json({ profile: await hydrateProfileMedia(supabase, c.get('user')) });
});

// Admin-only user directory: return only users whose Supabase email is confirmed.
app.get('/api/admin/users', authenticateUser, async (c) => {
  const currentUser = c.get('user');
  if (currentUser.role !== 'super_admin' && !currentUser.permissions?.includes('manage_users')) {
    return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
  }

  try {
    const supabase = createSupabaseClient(c.env);
    const { data: authPage, error: authError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (authError) throw authError;

    const confirmedIds = new Set(
      (authPage?.users || [])
        .filter((authUser: any) => Boolean(authUser.email_confirmed_at))
        .map((authUser: any) => authUser.id),
    );

    const { data: profiles, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .in('id', Array.from(confirmedIds));
    if (profileError) throw profileError;

    return c.json({ users: profiles || [] });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Failed to load users' }, 500);
  }
});


async function requireConfirmedTarget(supabase: any, targetId: string) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const target = (data?.users || []).find((authUser: any) => authUser.id === targetId);
  if (!target || !target.email_confirmed_at) throw new Error('Target user has not confirmed email');
  return target;
}

app.post('/api/admin/users/:id/approve', authenticateUser, async (c) => {
  try {
    const actor = c.get('user');
    if (actor.role !== 'super_admin' && !actor.permissions?.includes('manage_users')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const target = await requireConfirmedTarget(supabase, c.req.param('id'));
    const { data, error } = await supabase.from('user_profiles').update({ status: 'approved' }).eq('id', target.id).select('*').single();
    if (error) throw error;
    await writeAuditLog(supabase, c, actor.id, 'approve_user', 'user_profile', target.id, { new_status: 'approved' });
    return c.json({ user: data });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Failed to approve user' }, 400);
  }
});

app.post('/api/admin/users/:id/block', authenticateUser, async (c) => {
  try {
    const actor = c.get('user');
    if (actor.role !== 'super_admin' && !actor.permissions?.includes('manage_users')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const target = await requireConfirmedTarget(supabase, c.req.param('id'));
    const { data: targetProfile } = await supabase.from('user_profiles').select('role').eq('id', target.id).single();
    if (targetProfile?.role === 'super_admin') return c.json({ error: 'Cannot block a super admin' }, 403);
    const { data, error } = await supabase.from('user_profiles').update({ status: 'blocked' }).eq('id', target.id).select('*').single();
    if (error) throw error;
    await writeAuditLog(supabase, c, actor.id, 'block_user', 'user_profile', target.id, { new_status: 'blocked' });
    return c.json({ user: data });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Failed to block user' }, 400);
  }
});

app.post('/api/admin/users/:id/permissions', authenticateUser, async (c) => {
  try {
    const actor = c.get('user');
    if (actor.role !== 'super_admin') return c.json({ error: 'Forbidden - Only super admin can change roles' }, 403);
    const supabase = createSupabaseClient(c.env);
    const target = await requireConfirmedTarget(supabase, c.req.param('id'));
    const body = await c.req.json();
    const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p: any) => typeof p === 'string') : [];
    const role = body.role === 'admin' ? 'admin' : 'user';
    const { data, error } = await supabase.from('user_profiles').update({ role, permissions }).eq('id', target.id).select('*').single();
    if (error) throw error;
    await writeAuditLog(supabase, c, actor.id, 'change_user_permissions', 'user_profile', target.id, { role, permissions });
    return c.json({ user: data });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Failed to update permissions' }, 400);
  }
});

function decodeLegacyImage(value: unknown): { mimeType: string; bytes: Uint8Array } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  try {
    const binary = atob(match[2].replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (bytes.byteLength > PROFILE_MEDIA_MAX_BYTES) return null;
    return { mimeType: match[1], bytes };
  } catch {
    return null;
  }
}

function migrationExtension(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
}

function collectLegacyProfileMedia(profile: any): Array<{ fieldPath: string; value: string; slot: 'avatar' | 'personal-plan' | 'groups' | 'disciples' }> {
  const items: Array<{ fieldPath: string; value: string; slot: 'avatar' | 'personal-plan' | 'groups' | 'disciples' }> = [];
  if (decodeLegacyImage(profile.photo)) items.push({ fieldPath: 'photo', value: profile.photo, slot: 'avatar' });
  if (decodeLegacyImage(profile.personal_plan?.photo)) items.push({ fieldPath: 'personal_plan.photo', value: profile.personal_plan.photo, slot: 'personal-plan' });
  for (const [index, group] of (Array.isArray(profile.user_groups) ? profile.user_groups : []).entries()) {
    if (decodeLegacyImage(group?.photo)) items.push({ fieldPath: `user_groups.${index}.photo`, value: group.photo, slot: 'groups' });
  }
  for (const [index, disciple] of (Array.isArray(profile.disciples) ? profile.disciples : []).entries()) {
    if (decodeLegacyImage(disciple?.photo)) items.push({ fieldPath: `disciples.${index}.photo`, value: disciple.photo, slot: 'disciples' });
  }
  return items;
}

function replaceMigratedProfileMedia(profile: any, migrated: Map<string, string>): any {
  const next = structuredClone(profile);
  for (const [fieldPath, storagePath] of migrated.entries()) {
    const parts = fieldPath.split('.');
    if (parts[0] === 'photo') next.photo = storagePath;
    else if (parts[0] === 'personal_plan') next.personal_plan = { ...(next.personal_plan || {}), photo: storagePath };
    else if ((parts[0] === 'user_groups' || parts[0] === 'disciples') && parts.length === 3) {
      const collection = next[parts[0]];
      const index = Number(parts[1]);
      if (Array.isArray(collection) && collection[index]) collection[index] = { ...collection[index], photo: storagePath };
    }
  }
  return next;
}

app.post('/api/admin/profile-media/migrate', authenticateUser, async (c) => {
  try {
    const actor = c.get('user');
    if (actor.role !== 'super_admin') return c.json({ error: 'Forbidden - Only super admin can migrate profile media' }, 403);
    const body = await c.req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;
    const supabase = createSupabaseClient(c.env);
    const { data: profiles, error } = await supabase.from('user_profiles').select('id,email,photo,personal_plan,user_groups,disciples');
    if (error) throw error;
    const candidates = (profiles || []).flatMap((profile: any) => collectLegacyProfileMedia(profile).map((item) => ({ userId: profile.id, email: profile.email, fieldPath: item.fieldPath, slot: item.slot, chars: item.value.length })));
    if (dryRun) return c.json({ dryRun: true, total: candidates.length, candidates });
    const migratedByUser = new Map<string, Map<string, string>>();
    const migrated = [];
    for (const profile of profiles || []) {
      const items = collectLegacyProfileMedia(profile);
      const paths = new Map<string, string>();
      for (const item of items) {
        const decoded = decodeLegacyImage(item.value);
        if (!decoded) continue;
        const path = `${profile.id}/${item.slot}/legacy-${crypto.randomUUID()}.${migrationExtension(decoded.mimeType)}`;
        const backup = await supabase.from('profile_media_migration_backups').upsert({ user_id: profile.id, field_path: item.fieldPath, original_value: item.value, storage_path: path, created_by: actor.id }, { onConflict: 'user_id,field_path', ignoreDuplicates: true }).select('storage_path').maybeSingle();
        if (backup.error) throw backup.error;
        const storagePath = backup.data?.storage_path || path;
        const upload = await supabase.storage.from('profile-media').upload(storagePath, decoded.bytes, { contentType: decoded.mimeType, cacheControl: '3600', upsert: false });
        if (upload.error && !/already exists/i.test(upload.error.message || '')) throw upload.error;
        paths.set(item.fieldPath, storagePath);
        migrated.push({ userId: profile.id, fieldPath: item.fieldPath, storagePath });
      }
      if (paths.size) {
        const updated = replaceMigratedProfileMedia(profile, paths);
        const update = await supabase.from('user_profiles').update({ photo: updated.photo, personal_plan: updated.personal_plan, user_groups: updated.user_groups, disciples: updated.disciples, updated_at: new Date().toISOString() }).eq('id', profile.id);
        if (update.error) throw update.error;
        for (const [fieldPath, storagePath] of paths) await supabase.from('profile_media_migration_backups').update({ migrated_at: new Date().toISOString(), storage_path: storagePath }).eq('user_id', profile.id).eq('field_path', fieldPath);
        migratedByUser.set(profile.id, paths);
      }
    }
    await writeAuditLog(supabase, c, actor.id, 'migrate_profile_media', 'profile_media', 'legacy-batch', { count: migrated.length });
    return c.json({ dryRun: false, migrated: migrated.length, items: migrated });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Profile media migration failed' }, 500);
  }
});

// Home routes
app.get('/api/home', authenticateUser, async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const appData = await getAppData(supabase);
    return c.json({
      homeConfig: appData.homeConfig || {
        welcomeMessageAr: 'مرحباً بكم في موقع GCM', welcomeMessageEn: 'Welcome to the GCM Portal',
        planPhoto: '', planTextAr: '', planTextEn: '',
      },
      leaders: appData.leaders || [],
      groups: appData.groups || [],
    });
  } catch {
    return c.json({ homeConfig: { welcomeMessageAr: 'مرحباً بكم في موقع GCM', welcomeMessageEn: 'Welcome to the GCM Portal', planPhoto: '', planTextAr: '', planTextEn: '' }, leaders: [], groups: [] });
  }
});

app.post('/api/home/welcome', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_home')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { welcomeMessageAr, welcomeMessageEn } = await c.req.json();
    const appData = await getAppData(supabase);
    const updatedHomeConfig = { ...appData.homeConfig, welcomeMessageAr, welcomeMessageEn };
    await saveAppData(supabase, { ...appData, homeConfig: updatedHomeConfig });
    return c.json(updatedHomeConfig);
  } catch {
    return c.json({ error: 'Failed to update welcome message' }, 500);
  }
});

app.post('/api/home/plan', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_home')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { planPhoto, planTextAr, planTextEn } = await c.req.json();
    const appData = await getAppData(supabase);
    const updatedHomeConfig = { ...appData.homeConfig, planPhoto, planTextAr, planTextEn };
    await saveAppData(supabase, { ...appData, homeConfig: updatedHomeConfig });
    return c.json(updatedHomeConfig);
  } catch {
    return c.json({ error: 'Failed to update plan' }, 500);
  }
});

// Leaders routes
app.get('/api/leaders', authenticateUser, async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const appData = await getAppData(supabase);
    return c.json(appData.leaders || []);
  } catch {
    return c.json([]);
  }
});

app.post('/api/leaders', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_home')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { name, description, photo, groupId } = await c.req.json();
    if (!name) return c.json({ error: 'Leader name is required' }, 400);

    const appData = await getAppData(supabase);
    const leaders = appData.leaders || [];
    if (leaders.some((l: any) => l.name.toLowerCase() === name.toLowerCase())) {
      return c.json({ error: 'Leader with this name already exists' }, 400);
    }
    const newLeader = { id: `leader-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, name, description: description || '', photo: photo || '', groupId: groupId || '' };
    await saveAppData(supabase, { ...appData, leaders: [...leaders, newLeader] });
    return c.json(newLeader, 201);
  } catch {
    return c.json({ error: 'Failed to add leader' }, 500);
  }
});

app.put('/api/leaders/:id', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_home')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { id } = c.req.param();
    const { name, description, photo, groupId } = await c.req.json();
    const appData = await getAppData(supabase);
    const leaders = appData.leaders || [];
    const idx = leaders.findIndex((l: any) => l.id === id);
    if (idx === -1) return c.json({ error: 'Leader not found' }, 404);
    leaders[idx] = { ...leaders[idx], name: name || leaders[idx].name, description: description !== undefined ? description : leaders[idx].description, photo: photo !== undefined ? photo : leaders[idx].photo, groupId: groupId !== undefined ? groupId : leaders[idx].groupId };
    await saveAppData(supabase, { ...appData, leaders });
    return c.json(leaders[idx]);
  } catch {
    return c.json({ error: 'Failed to update leader' }, 500);
  }
});

app.delete('/api/leaders/:id', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_home')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { id } = c.req.param();
    const appData = await getAppData(supabase);
    await saveAppData(supabase, { ...appData, leaders: (appData.leaders || []).filter((l: any) => l.id !== id) });
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Failed to delete leader' }, 500);
  }
});

// Groups routes
app.get('/api/groups', authenticateUser, async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const appData = await getAppData(supabase);
    return c.json(appData.groups || []);
  } catch {
    return c.json([]);
  }
});

app.post('/api/groups', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_groups')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { title, description, photo } = await c.req.json();
    if (!title || !description) return c.json({ error: 'Title and description are required' }, 400);
    const appData = await getAppData(supabase);
    const newGroup = { id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, title, description, photo: photo || '' };
    await saveAppData(supabase, { ...appData, groups: [...(appData.groups || []), newGroup] });
    return c.json(newGroup, 201);
  } catch {
    return c.json({ error: 'Failed to add group' }, 500);
  }
});

app.put('/api/groups/:id', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_groups')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { id } = c.req.param();
    const { title, description, photo } = await c.req.json();
    const appData = await getAppData(supabase);
    const groups = appData.groups || [];
    const idx = groups.findIndex((g: any) => g.id === id);
    if (idx === -1) return c.json({ error: 'Group not found' }, 404);
    groups[idx] = { ...groups[idx], title: title || groups[idx].title, description: description !== undefined ? description : groups[idx].description, photo: photo !== undefined ? photo : groups[idx].photo };
    await saveAppData(supabase, { ...appData, groups });
    return c.json(groups[idx]);
  } catch {
    return c.json({ error: 'Failed to update group' }, 500);
  }
});

app.delete('/api/groups/:id', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_groups')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { id } = c.req.param();
    const appData = await getAppData(supabase);
    await saveAppData(supabase, { ...appData, groups: (appData.groups || []).filter((g: any) => g.id !== id) });
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Failed to delete group' }, 500);
  }
});

// Library routes
app.get('/api/library', authenticateUser, async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const appData = await getAppData(supabase);
    const textItems = (appData.library || []).filter((item: any) => item.type === 'text');
    const { data: videos } = await supabase.from('videos').select('id, type, title, description, file_url').order('created_at', { ascending: false });
    const mediaItems = (videos || []).map((v: any) => ({
      id: v.id,
      type: v.type,
      title: v.title,
      description: v.description,
      url: typeof v.file_url === 'string' && v.file_url.trim()
        ? v.file_url
        : `/api/videos/stream/${v.id}`,
    }));
    return c.json([...textItems, ...mediaItems]);
  } catch {
    return c.json([]);
  }
});

app.post('/api/library', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_library')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { type, title, description, url, mediaId } = await c.req.json();
    if (!title || !description || !type) {
      return c.json({ error: 'Title, description, and type are required' }, 400);
    }
    if (type === 'text') {
      const appData = await getAppData(supabase);
      const newItem = { id: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, type, title, description, url: '' };
      await saveAppData(supabase, { ...appData, library: [...(appData.library || []), newItem] });
      await writeAuditLog(supabase, c, user.id, 'create_library_item', 'library_item', newItem.id, { item_type: 'text' });
      return c.json(newItem, 201);
    }
    if (mediaId) {
      const { data: updated } = await supabase.from('videos').update({ title, description }).eq('id', mediaId).select().single();
      await writeAuditLog(supabase, c, user.id, 'update_media', 'video', mediaId, { fields: ['title', 'description'] });
      return c.json({ id: updated.id, type: updated.type, title: updated.title, description: updated.description, url: updated.file_url || '' });
    }
    if (!url) return c.json({ error: 'A YouTube URL is required', code: 'youtube_only' }, 400);
    if (type !== 'video' || !isAllowedYouTubeUrl(url)) {
      return c.json({ error: 'Only valid HTTPS YouTube URLs are allowed', code: 'youtube_only' }, 400);
    }
    const { data: created } = await supabase.from('videos').insert({
      type: 'video', title, description, file_url: url.trim(), storage_path: null,
      size_bytes: 0, mime_type: 'video/youtube', status: 'ready',
    }).select().single();
    await writeAuditLog(supabase, c, user.id, 'create_external_media', 'video', created.id, { media_type: type });
    return c.json({ id: created.id, type: created.type, title: created.title, description: created.description, url: created.file_url || '' }, 201);
  } catch {
    return c.json({ error: 'Failed to add library item' }, 500);
  }
});

app.put('/api/library/:id', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_library')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { id } = c.req.param();
    const { title, description, url } = await c.req.json();
    if (!title || !description) return c.json({ error: 'Title and description are required' }, 400);
    if (id.startsWith('lib-')) {
      const appData = await getAppData(supabase);
      const library = (appData.library || []).map((item: any) => item.id === id ? { ...item, title, description } : item);
      await saveAppData(supabase, { ...appData, library });
      await writeAuditLog(supabase, c, user.id, 'update_library_item', 'library_item', id, { fields: ['title', 'description'] });
      return c.json({ id, type: 'text', title, description, url: '' });
    }
    const updateFields: Record<string, string> = { title, description };
    if (url) {
      if (!isAllowedYouTubeUrl(url)) {
        return c.json({ error: 'Only valid HTTPS YouTube URLs are allowed', code: 'youtube_only' }, 400);
      }
      updateFields.file_url = url.trim();
    }
    const { data: updated } = await supabase.from('videos').update(updateFields).eq('id', id).select().single();
    await writeAuditLog(supabase, c, user.id, 'update_media', 'video', id, { fields: Object.keys(updateFields) });
    return c.json({ id: updated.id, type: updated.type, title: updated.title, description: updated.description, url: updated.file_url || '' });
  } catch {
    return c.json({ error: 'Failed to update library item' }, 500);
  }
});

app.delete('/api/library/:id', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_library')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { id } = c.req.param();
    if (id.startsWith('lib-')) {
      const appData = await getAppData(supabase);
      await saveAppData(supabase, { ...appData, library: (appData.library || []).filter((item: any) => item.id !== id) });
      await writeAuditLog(supabase, c, user.id, 'delete_library_item', 'library_item', id);
      return c.json({ success: true });
    }
    const { data: mediaRow } = await supabase.from('videos').select('storage_path').eq('id', id).maybeSingle();
    await supabase.from('videos').delete().eq('id', id);
    if (mediaRow?.storage_path) {
      const paths = (() => { try { const parsed = JSON.parse(mediaRow.storage_path); return Array.isArray(parsed) ? parsed : [mediaRow.storage_path]; } catch { return [mediaRow.storage_path]; } })();
      await supabase.storage.from('media').remove(paths);
    }
    await writeAuditLog(supabase, c, user.id, 'delete_media', 'video', id);
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Failed to delete library item' }, 500);
  }
});

const PROFILE_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PROFILE_MEDIA_SLOTS = new Set(['avatar', 'personal-plan', 'groups', 'disciples']);

function profileMediaExtension(contentType: string): string {
  return contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
}

function isSafeProfileMediaPath(value: unknown, userId: string, allowAdmin: boolean, profile: any): value is string {
  if (typeof value !== 'string' || value.length > 300 || value.includes('..') || value.includes('\\') || value.startsWith('/')) return false;
  const parts = value.split('/');
  if (parts.length !== 3 || parts[0] !== userId || !PROFILE_MEDIA_SLOTS.has(parts[1])) return false;
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(parts[2])) return false;
  return allowAdmin || parts[0] === profile.id;
}

app.post('/api/profile-media/upload', authenticateAnyUser, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.parseBody();
    const slot = typeof body.slot === 'string' ? body.slot : '';
    const file = body.file;
    if (!PROFILE_MEDIA_SLOTS.has(slot) || !(file instanceof File)) {
      return c.json({ error: 'Invalid profile media upload', code: 'profile_media_invalid_upload' }, 400);
    }
    if (file.size <= 0 || file.size > PROFILE_MEDIA_MAX_BYTES) {
      return c.json({ error: 'Profile image is too large', code: 'profile_media_too_large' }, 413);
    }
    const contentType = String(file.type || '').toLowerCase();
    if (!PROFILE_MEDIA_TYPES.has(contentType)) {
      return c.json({ error: 'Unsupported profile image type', code: 'profile_media_invalid_type' }, 400);
    }
    const path = `${user.id}/${slot}/${crypto.randomUUID()}.${profileMediaExtension(contentType)}`;
    const supabase = createSupabaseClient(c.env);
    const { error } = await supabase.storage.from('profile-media').upload(path, await file.arrayBuffer(), {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw error;
    if (slot === 'avatar') {
      const { error: profileError } = await supabase.from('user_profiles').update({ photo: path, updated_at: new Date().toISOString() }).eq('id', user.id);
      if (profileError) {
        await supabase.storage.from('profile-media').remove([path]);
        throw profileError;
      }
    }
    await writeAuditLog(supabase, c, user.id, 'upload_profile_media', 'profile_media', path, { slot, size_bytes: file.size, content_type: contentType });
    return c.json({ path, slot });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Failed to upload profile image', code: 'profile_media_upload_failed' }, 500);
  }
});

app.post('/api/profile-media/sign', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const path = body?.path;
    const isAdmin = user.role === 'admin' || user.role === 'super_admin';
    if (!isSafeProfileMediaPath(path, user.id, isAdmin, user)) {
      return c.json({ error: 'Profile image not found', code: 'profile_media_not_found' }, 404);
    }
    const supabase = createSupabaseClient(c.env);
    const { data, error } = await supabase.storage.from('profile-media').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return c.json({ error: 'Profile image not found', code: 'profile_media_not_found' }, 404);
    return c.json({ signedUrl: data.signedUrl, expiresIn: 3600 });
  } catch {
    return c.json({ error: 'Failed to create profile image URL', code: 'profile_media_sign_failed' }, 500);
  }
});

app.delete('/api/profile-media', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const path = body?.path;
    if (!isSafeProfileMediaPath(path, user.id, false, user)) {
      return c.json({ error: 'Profile image not found', code: 'profile_media_not_found' }, 404);
    }
    const supabase = createSupabaseClient(c.env);
    const { error } = await supabase.storage.from('profile-media').remove([path]);
    if (error) throw error;
    await writeAuditLog(supabase, c, user.id, 'delete_profile_media', 'profile_media', path);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Failed to delete profile image', code: 'profile_media_delete_failed' }, 500);
  }
});

async function signProfileMediaValue(supabase: any, value: unknown): Promise<unknown> {
  if (typeof value !== 'string' || !value.includes('/')) return value;
  const parts = value.split('/');
  if (parts.length !== 3 || !PROFILE_MEDIA_SLOTS.has(parts[1])) return value;
  const { data } = await supabase.storage.from('profile-media').createSignedUrl(value, 3600);
  return data?.signedUrl || value;
}

async function hydrateProfileMedia(supabase: any, profile: any): Promise<any> {
  if (!profile) return profile;
  const hydrated = { ...profile };
  hydrated.photo = await signProfileMediaValue(supabase, profile.photo);
  if (profile.personal_plan && typeof profile.personal_plan === 'object') {
    hydrated.personal_plan = { ...profile.personal_plan };
    hydrated.personal_plan.photo = await signProfileMediaValue(supabase, profile.personal_plan.photo);
  }
  if (Array.isArray(profile.user_groups)) {
    hydrated.user_groups = await Promise.all(profile.user_groups.map(async (group: any) => ({ ...group, photo: await signProfileMediaValue(supabase, group.photo) })));
  }
  if (Array.isArray(profile.disciples)) {
    hydrated.disciples = await Promise.all(profile.disciples.map(async (disciple: any) => ({ ...disciple, photo: await signProfileMediaValue(supabase, disciple.photo) })));
  }
  return hydrated;
}

// Profile routes
app.post('/api/profile/update', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    const supabase = createSupabaseClient(c.env);
    const { photo, counts, personalPlan } = await c.req.json();
    if (photo !== undefined && photo !== '' && !isSafeProfileMediaPath(photo, user.id, false, user)) return c.json({ error: 'Invalid profile image path', code: 'profile_media_invalid_path' }, 400);
    const updates: any = { updated_at: new Date().toISOString() };
    if (photo !== undefined) updates.photo = photo;
    if (counts !== undefined) updates.counts = counts;
    if (personalPlan !== undefined) {
      if (personalPlan.photo !== undefined && personalPlan.photo !== '' && !isSafeProfileMediaPath(personalPlan.photo, user.id, false, user)) return c.json({ error: 'Invalid plan image path', code: 'profile_media_invalid_path' }, 400);
      updates.personal_plan = personalPlan;
    }
    const { data, error } = await supabase.from('user_profiles').update(updates).eq('id', user.id).select('*').single();
    if (error) throw error;
    return c.json({ user: await hydrateProfileMedia(supabase, data) });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update profile' }, 500);
  }
});

app.post('/api/profile/disciples', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    const supabase = createSupabaseClient(c.env);
    const { action, discipleId, name, description, photo } = await c.req.json();
    if (photo && !isSafeProfileMediaPath(photo, user.id, false, user)) return c.json({ error: 'Invalid disciple image path', code: 'profile_media_invalid_path' }, 400);
    const { data: profile } = await supabase.from('user_profiles').select('disciples').eq('id', user.id).single();
    let disciples = profile?.disciples || [];
    if (action === 'add') {
      disciples.push({ id: `disciple-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, name, description: description || '', photo: photo || '' });
    } else if (action === 'edit' && discipleId) {
      const idx = disciples.findIndex((d: any) => d.id === discipleId);
      if (idx === -1) return c.json({ error: 'Disciple not found' }, 404);
      disciples[idx] = { ...disciples[idx], name: name || disciples[idx].name, description: description !== undefined ? description : disciples[idx].description, photo: photo !== undefined ? photo : disciples[idx].photo };
    } else if (action === 'delete' && discipleId) {
      disciples = disciples.filter((d: any) => d.id !== discipleId);
    }
    const { data: updatedProfile } = await supabase.from('user_profiles').update({ disciples, updated_at: new Date().toISOString() }).eq('id', user.id).select('*').single();
    return c.json({ user: await hydrateProfileMedia(supabase, updatedProfile) });
  } catch {
    return c.json({ error: 'Failed to manage disciples' }, 500);
  }
});

app.post('/api/profile/groups', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    const supabase = createSupabaseClient(c.env);
    const { action, groupId, title, description, photo, memberIds } = await c.req.json();
    if (photo && !isSafeProfileMediaPath(photo, user.id, false, user)) return c.json({ error: 'Invalid group image path', code: 'profile_media_invalid_path' }, 400);
    const { data: profile } = await supabase.from('user_profiles').select('user_groups').eq('id', user.id).single();
    let userGroups = profile?.user_groups || [];
    if (action === 'add') {
      userGroups.push({ id: `ugroup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, title, description: description || '', photo: photo || '', memberIds: memberIds || [] });
    } else if (action === 'edit' && groupId) {
      const idx = userGroups.findIndex((g: any) => g.id === groupId);
      if (idx === -1) return c.json({ error: 'Group not found' }, 404);
      userGroups[idx] = { ...userGroups[idx], title: title || userGroups[idx].title, description: description !== undefined ? description : userGroups[idx].description, photo: photo !== undefined ? photo : userGroups[idx].photo, memberIds: memberIds !== undefined ? memberIds : userGroups[idx].memberIds };
    } else if (action === 'delete' && groupId) {
      userGroups = userGroups.filter((g: any) => g.id !== groupId);
    }
    const { data: updatedProfile } = await supabase.from('user_profiles').update({ user_groups: userGroups, updated_at: new Date().toISOString() }).eq('id', user.id).select('*').single();
    return c.json({ user: await hydrateProfileMedia(supabase, updatedProfile) });
  } catch {
    return c.json({ error: 'Failed to manage groups' }, 500);
  }
});

function isAllowedYouTubeUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'youtu.be') {
      return /^[a-zA-Z0-9_-]{11}$/.test(url.pathname.slice(1));
    }
    if (hostname !== 'youtube.com' && hostname !== 'm.youtube.com') return false;
    if (url.pathname === '/watch') {
      return /^[a-zA-Z0-9_-]{11}$/.test(url.searchParams.get('v') || '');
    }
    const match = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})$/);
    return Boolean(match);
  } catch {
    return false;
  }
}

const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']);

function isSafeStoragePath(path: string, mediaType: string): boolean {
  if (!path || path.includes('..') || path.startsWith('/') || path.includes('\\')) return false;
  const requiredPrefix = mediaType === 'photo' ? 'photos/' : 'videos/';
  return path.startsWith(requiredPrefix);
}

// Video upload routes (simplified for Workers - uses Supabase Storage for everything)
app.post('/api/videos/register', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_library')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { title, description, fileName, mimeType, sizeBytes, storagePath, parts, type } = await c.req.json();
    if (type !== 'photo') {
      return c.json({ error: 'Direct video uploads are disabled. Use a YouTube URL.', code: 'youtube_only' }, 410);
    }
    const mediaType = 'photo';
    const normalizedMime = String(mimeType || '').toLowerCase();
    const normalizedSize = Number(sizeBytes || 0);
    if (!title || String(title).length > 200 || String(description || '').length > 5000) {
      return c.json({ error: 'Invalid title or description' }, 400);
    }
    if (!ALLOWED_MEDIA_TYPES.has(normalizedMime) || (mediaType === 'photo' && !normalizedMime.startsWith('image/')) || (mediaType === 'video' && !normalizedMime.startsWith('video/'))) {
      return c.json({ error: 'Unsupported media type', code: 'unsupported_media_type' }, 400);
    }
    if (!Number.isSafeInteger(normalizedSize) || normalizedSize <= 0 || normalizedSize > MAX_MEDIA_BYTES) {
      return c.json({ error: 'Media file is too large or invalid', code: 'media_too_large' }, 413);
    }
    if (!storagePath && !parts) return c.json({ error: 'Either storagePath or parts is required' }, 400);

    let storagePathValue: string;
    const uploadParts = parts && Array.isArray(parts) && parts.length > 0 ? parts : [storagePath];
    if (uploadParts.length > 50 || uploadParts.some((part: any) => typeof part !== 'string' || !isSafeStoragePath(part, mediaType))) {
      return c.json({ error: 'Invalid storage path' }, 400);
    }
    storagePathValue = parts && Array.isArray(parts) && parts.length > 0 ? JSON.stringify(parts) : String(storagePath);

    const { data: video, error: dbError } = await supabase.from('videos').insert({
      type: mediaType, title, description: description || '',
      file_name: typeof fileName === 'string' ? fileName.slice(0, 255) : null, storage_path: storagePathValue, file_url: '',
      mime_type: normalizedMime,
      size_bytes: normalizedSize, duration_seconds: 0, status: 'ready',
    }).select().single();

    if (dbError) throw dbError;

    const streamUrl = `/api/videos/stream/${video.id}`;
    await supabase.from('videos').update({ file_url: streamUrl }).eq('id', video.id);
    video.file_url = streamUrl;
    await writeAuditLog(supabase, c, user.id, 'upload_media', 'video', video.id, { media_type: mediaType, mime_type: normalizedMime, size_bytes: normalizedSize });

    return c.json({ success: true, publicUrl: streamUrl, video });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to register uploaded video' }, 500);
  }
});

// Video stream - concatenate parts from Supabase Storage on-the-fly
app.get('/api/videos/stream/:id', authenticateUser, async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', c.req.param('id'))
      .eq('status', 'ready')
      .single();
    if (error || !video) return c.json({ error: 'Video not found' }, 404);

    let parts: string[];
    try {
      const parsed = JSON.parse(video.storage_path);
      parts = Array.isArray(parsed) ? parsed : [video.storage_path];
    } catch {
      parts = [video.storage_path];
    }

    const totalSize = video.size_bytes || 0;
    const contentType = video.mime_type || 'video/mp4';

    if (parts.length === 1) {
      const { data: blob, error: downloadError } = await supabase.storage.from('media').download(parts[0]);
      if (downloadError || !blob) return c.json({ error: 'Media file not found' }, 404);
      return new Response(blob, { status: 200, headers: { 'Content-Type': contentType, 'Content-Length': String(blob.size), 'Cache-Control': 'private, no-store' } });
    }

    const range = c.req.header('Range');
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (!match) return c.json({ error: 'Range Not Satisfiable' }, 416);
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
      const chunkSize = end - start + 1;
      if (start >= totalSize || end >= totalSize) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${totalSize}` } });
      }

      const body = new ReadableStream({
        async start(controller) {
          let byteOffset = 0;
          let bytesRemaining = chunkSize;
          for (const part of parts) {
            if (bytesRemaining <= 0) break;
            const { data: partBlob, error: partError } = await supabase.storage.from('media').download(part);
            if (partError || !partBlob) break;
            const partBuf = await partBlob.arrayBuffer();
            const partSize = partBuf.byteLength;
            const partEnd = byteOffset + partSize;
            if (partEnd > start && byteOffset <= end) {
              const sliceStart = Math.max(0, start - byteOffset);
              const sliceEnd = Math.min(partSize, end - byteOffset + 1);
              controller.enqueue(new Uint8Array(partBuf.slice(sliceStart, sliceEnd)));
              bytesRemaining -= (sliceEnd - sliceStart);
            }
            byteOffset += partSize;
          }
          controller.close();
        },
      });

      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      });
    }

    const body = new ReadableStream({
      async start(controller) {
        for (const part of parts) {
          const { data: partBlob, error: partError } = await supabase.storage.from('media').download(part);
          if (partError || !partBlob) break;
          const partBuf = await partBlob.arrayBuffer();
          controller.enqueue(new Uint8Array(partBuf));
        }
        controller.close();
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(totalSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return c.json({ error: 'Failed to stream video' }, 500);
  }
});

// Serve static assets from the Vite build output, then fallback to index.html for SPA
app.get('*', async (c) => {
  const req = c.req.raw;
  const env = c.env as any;

  const addSecurityHeaders = (response: Response) => {
    const securedResponse = new Response(response.body, response);

    securedResponse.headers.set(
      'X-Content-Type-Options',
      'nosniff',
    );
    securedResponse.headers.set(
      'X-Frame-Options',
      'DENY',
    );
    securedResponse.headers.set(
      'Referrer-Policy',
      'strict-origin-when-cross-origin',
    );
    securedResponse.headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    securedResponse.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );

    return securedResponse;
  };

  try {
    const response = await env.ASSETS.fetch(req);
    if (response.status < 400) {
      return addSecurityHeaders(response);
    }
  } catch {}

  try {
    const url = new URL(req.url);
    url.pathname = '/index.html';

    const response = await env.ASSETS.fetch(
      new Request(url.toString(), req),
    );

    return addSecurityHeaders(response);
  } catch {
    return c.text('Not Found', 404);
  }
});

export default app;
