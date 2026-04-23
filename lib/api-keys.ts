import { createHash, randomBytes } from 'crypto';
import { getServiceSupabase } from './supabase/service';

const KEY_PREFIX = 'hlk_';

export function generateKey(): { raw: string; prefix: string; hash: string } {
  // 24 random bytes → 32-char base64url → 36 chars total with prefix.
  const token = randomBytes(24).toString('base64url');
  const raw = `${KEY_PREFIX}${token}`;
  const prefix = raw.slice(0, 12);
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export type ResolvedKey = { userId: string; keyId: string };

export async function resolveApiKey(token: string): Promise<ResolvedKey | null> {
  if (!token || !token.startsWith(KEY_PREFIX)) return null;
  const svc = getServiceSupabase();
  if (!svc) return null;
  const hash = hashKey(token);
  const { data } = await svc
    .from('api_keys')
    .select('id,user_id,revoked_at')
    .eq('key_hash', hash)
    .limit(1)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  // Fire-and-forget: mark last_used_at.
  svc.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => null, () => null);
  return { userId: data.user_id, keyId: data.id };
}

export function extractBearer(req: Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
