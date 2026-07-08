import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createSupabaseClient, type SupabaseEnv } from './src/lib/supabase-server';

type Env = {
  Bindings: SupabaseEnv & {
    ASSETS: { fetch: (request: Request) => Promise<Response> };
  };
};

const app = new Hono<Env>();

app.use('*', cors());

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
  c.set('user', await ensureUserProfile(supabase, user));
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

// Auth routes
app.post('/api/auth/signup', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const { email = '', password = '', firstName = '', lastName = '', phone = '', photo = '' } = await c.req.json();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedFirstName = String(firstName).trim();
    const normalizedLastName = String(lastName).trim();
    const normalizedPhone = String(phone).trim();

    if (!normalizedEmail || !password || !normalizedFirstName || !normalizedLastName) {
      return c.json({ error: 'Missing required signup fields' }, 400);
    }
    if (String(password).length < 6) {
      return c.json({ error: 'Password must be at least 6 characters long' }, 400);
    }

    const { data: blockedMatches } = await supabase.from('user_profiles')
      .select('id').eq('status', 'blocked')
      .or(`email.eq.${normalizedEmail}${normalizedPhone ? `,phone.eq.${normalizedPhone}` : ''}`);
    if (blockedMatches && blockedMatches.length > 0) {
      return c.json({ error: 'This email or phone number has been blocked by the administrator.', code: 'blocked' }, 403);
    }

    const { data: createdUserData, error: createUserError } = await supabase.auth.admin.createUser({
      email: normalizedEmail, password: String(password), email_confirm: true,
      user_metadata: { first_name: normalizedFirstName, last_name: normalizedLastName, phone: normalizedPhone },
    });
    if (createUserError || !createdUserData?.user) {
      const message = createUserError?.message || 'Failed to create account';
      const statusCode = /already|exists|registered/i.test(message) ? 409 : 400;
      return c.json({ error: message }, statusCode);
    }

    const profile = await ensureUserProfile(supabase, createdUserData.user, { photo: photo || null, phone: normalizedPhone });
    return c.json({ profile }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create account' }, 500);
  }
});

app.get('/api/auth/profile', authenticateUser, async (c) => {
  return c.json({ profile: c.get('user') });
});

// Home routes
app.get('/api/home', async (c) => {
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
app.get('/api/leaders', async (c) => {
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
app.get('/api/groups', async (c) => {
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
app.get('/api/library', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const appData = await getAppData(supabase);
    const textItems = (appData.library || []).filter((item: any) => item.type === 'text');
    const { data: videos } = await supabase.from('videos').select('id, type, title, description, file_url').order('created_at', { ascending: false });
    const mediaItems = (videos || []).map((v: any) => ({ id: v.id, type: v.type, title: v.title, description: v.description, url: v.file_url || '' }));
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
      return c.json(newItem, 201);
    }
    if (mediaId) {
      const { data: updated } = await supabase.from('videos').update({ title, description }).eq('id', mediaId).select().single();
      return c.json({ id: updated.id, type: updated.type, title: updated.title, description: updated.description, url: updated.file_url || '' });
    }
    if (!url) return c.json({ error: 'A file upload or external URL is required' }, 400);
    const { data: created } = await supabase.from('videos').insert({ type, title, description, file_url: url, status: 'ready' }).select().single();
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
      return c.json({ id, type: 'text', title, description, url: '' });
    }
    const updateFields: Record<string, string> = { title, description };
    if (url) updateFields.file_url = url;
    const { data: updated } = await supabase.from('videos').update(updateFields).eq('id', id).select().single();
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
      return c.json({ success: true });
    }
    const { data: mediaRow } = await supabase.from('videos').select('storage_path').eq('id', id).maybeSingle();
    await supabase.from('videos').delete().eq('id', id);
    if (mediaRow?.storage_path) supabase.storage.from('media').remove([mediaRow.storage_path]);
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Failed to delete library item' }, 500);
  }
});

// Profile routes
app.post('/api/profile/update', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    const supabase = createSupabaseClient(c.env);
    const { photo, counts, personalPlan } = await c.req.json();
    const updates: any = { updated_at: new Date().toISOString() };
    if (photo !== undefined) updates.photo = photo;
    if (counts !== undefined) updates.counts = counts;
    if (personalPlan !== undefined) updates.personal_plan = personalPlan;
    const { data } = await supabase.from('user_profiles').update(updates).eq('id', user.id).select('*').single();
    return c.json({ user: data });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update profile' }, 500);
  }
});

app.post('/api/profile/disciples', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    const supabase = createSupabaseClient(c.env);
    const { action, discipleId, name, description, photo } = await c.req.json();
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
    return c.json({ user: updatedProfile });
  } catch {
    return c.json({ error: 'Failed to manage disciples' }, 500);
  }
});

app.post('/api/profile/groups', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    const supabase = createSupabaseClient(c.env);
    const { action, groupId, title, description, photo, memberIds } = await c.req.json();
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
    return c.json({ user: updatedProfile });
  } catch {
    return c.json({ error: 'Failed to manage groups' }, 500);
  }
});

// Video upload routes (simplified for Workers - uses Supabase Storage for everything)
app.post('/api/videos/register', authenticateUser, async (c) => {
  try {
    const user = c.get('user');
    if (user.role !== 'super_admin' && !user.permissions?.includes('edit_library')) {
      return c.json({ error: 'Forbidden - Insufficient permissions' }, 403);
    }
    const supabase = createSupabaseClient(c.env);
    const { title, description, fileName, mimeType, sizeBytes, storagePath, parts, type } = await c.req.json();
    const mediaType = type === 'photo' ? 'photo' : 'video';
    if (!storagePath && !parts) return c.json({ error: 'Either storagePath or parts is required' }, 400);

    let storagePathValue: string;
    let publicUrl: string;

    if (parts && Array.isArray(parts) && parts.length > 0) {
      storagePathValue = JSON.stringify(parts);
      publicUrl = '';
    } else if (storagePath) {
      storagePathValue = storagePath;
      const { data: { publicUrl: url } } = supabase.storage.from('media').getPublicUrl(storagePath);
      publicUrl = url;
    } else {
      return c.json({ error: 'Invalid storagePath or parts' }, 400);
    }

    const { data: video, error: dbError } = await supabase.from('videos').insert({
      type: mediaType, title: title || fileName || 'Untitled', description: description || '',
      file_name: fileName || null, storage_path: storagePathValue, file_url: publicUrl,
      mime_type: mimeType || (mediaType === 'photo' ? 'image/jpeg' : 'video/mp4'),
      size_bytes: sizeBytes || 0, duration_seconds: 0, status: 'ready',
    }).select().single();

    if (dbError) throw dbError;

    if (parts && Array.isArray(parts) && parts.length > 0) {
      const streamUrl = `/api/videos/stream/${video.id}`;
      await supabase.from('videos').update({ file_url: streamUrl }).eq('id', video.id);
      video.file_url = streamUrl;
    }

    return c.json({ success: true, publicUrl, video });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to register uploaded video' }, 500);
  }
});

// Video stream - concatenate parts from Supabase Storage on-the-fly
app.get('/api/videos/stream/:id', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const { data: video, error } = await supabase.from('videos').select('*').eq('id', c.req.param('id')).single();
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

    if (parts.length === 1 && video.file_url && !video.file_url.startsWith('/api/')) {
      return c.redirect(video.file_url, 302);
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
            const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(part);
            const partRes = await fetch(publicUrl);
            if (!partRes.ok) break;
            const partBuf = await partRes.arrayBuffer();
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
          const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(part);
          const partRes = await fetch(publicUrl);
          if (!partRes.ok) break;
          const partBuf = await partRes.arrayBuffer();
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
  try {
    const response = await env.ASSETS.fetch(req);
    if (response.status < 400) return response;
  } catch {}
  try {
    const url = new URL(req.url);
    url.pathname = '/index.html';
    return await env.ASSETS.fetch(new Request(url.toString(), req));
  } catch {
    return c.text('Not Found', 404);
  }
});

export default app;
