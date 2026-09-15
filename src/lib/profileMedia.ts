import { supabase } from './supabase';

export async function uploadProfileMedia(file: File, slot: 'avatar' | 'personal-plan' | 'groups' | 'disciples', errorMessage: string): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(errorMessage);
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error(errorMessage);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error(errorMessage);
  const formData = new FormData();
  formData.append('slot', slot);
  formData.append('file', file, file.name);
  const response = await fetch('/api/profile-media/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.path !== 'string') throw new Error(errorMessage);
  return payload.path;
}
