import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One computer and one phone (or tablet) per login. Slots live in
// app_metadata.devices (server-only):
//   { computer?: Device, phone?: Device }
// A fresh sign-in takes over its slot; a device that lost its slot has its
// session ended when it next checks in. Admins are exempt. Team and Fleet
// seats are separate logins, so each person gets their own two slots.
//
// POST { deviceId, kind, label, fresh? }          → check in
// POST { action: 'signout_others', deviceId, kind, label }
// GET                                               → this account's devices

type Kind = 'computer' | 'phone';
type Device = { id: string; label: string; at: string; seen: string };
type Devices = Partial<Record<Kind, Device>>;

const SEEN_WRITE_MS = 30 * 60_000; // refresh "last seen" at most every 30 minutes

async function context() {
  const supabase = getServerSupabase();
  if (!supabase) return { demo: true as const };
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  const svc = getServiceSupabase();
  if (!svc) return { error: NextResponse.json({ error: 'Service role not configured' }, { status: 500 }) };
  const { data: sess } = await supabase.auth.getSession();
  return { supabase, svc, user, accessToken: sess?.session?.access_token || null, admin: await isAdmin(user.email) };
}

function parseDevice(b: any): { id: string; kind: Kind; label: string } | null {
  const id = String(b?.deviceId || '');
  const kind = b?.kind === 'phone' ? 'phone' : b?.kind === 'computer' ? 'computer' : null;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || !kind) return null;
  const label = String(b?.label || (kind === 'phone' ? 'Phone or tablet' : 'Computer')).replace(/[^\w .,()/-]/g, '').slice(0, 60);
  return { id, kind, label };
}

// Write devices into the freshest app_metadata so other server-set fields
// (company verification, planner counters, …) are never overwritten.
async function saveDevices(svc: any, userId: string, devices: Devices) {
  const { data: fresh } = await svc.auth.admin.getUserById(userId);
  const base = (fresh?.user?.app_metadata as any) || {};
  await svc.auth.admin.updateUserById(userId, { app_metadata: { ...base, devices } });
}

export async function GET() {
  const c = await context();
  if ('demo' in c) return NextResponse.json({ devices: {}, exempt: true });
  if ('error' in c) return c.error;
  return NextResponse.json({ devices: ((c.user.app_metadata as any)?.devices || {}) as Devices, exempt: c.admin });
}

export async function POST(req: Request) {
  const c = await context();
  if ('demo' in c) return NextResponse.json({ ok: true, exempt: true });
  if ('error' in c) return c.error;
  const b = await req.json().catch(() => null);
  const d = parseDevice(b);
  if (!d) return NextResponse.json({ error: 'Invalid device' }, { status: 400 });
  if (c.admin) return NextResponse.json({ ok: true, exempt: true });

  const now = new Date().toISOString();
  const devices: Devices = { ...(((c.user.app_metadata as any)?.devices || {}) as Devices) };
  const slot = devices[d.kind];
  const me: Device = { id: d.id, label: d.label, at: slot?.id === d.id ? slot.at : now, seen: now };

  if (b?.action === 'signout_others') {
    await saveDevices(c.svc, c.user.id, { [d.kind]: me });
    // Ends every other session of this login right away.
    if (c.accessToken) await c.svc.auth.admin.signOut(c.accessToken, 'others').catch(() => null);
    return NextResponse.json({ ok: true, devices: { [d.kind]: me } });
  }

  // Free slot, or this device already holds it.
  if (!slot || slot.id === d.id) {
    if (!slot || slot.label !== d.label || Date.now() - Date.parse(slot.seen || slot.at) > SEEN_WRITE_MS) {
      devices[d.kind] = me;
      await saveDevices(c.svc, c.user.id, devices);
    }
    return NextResponse.json({ ok: true });
  }

  // A fresh sign-in on this device takes over the slot.
  if (b?.fresh) {
    devices[d.kind] = me;
    await saveDevices(c.svc, c.user.id, devices);
    return NextResponse.json({ ok: true, replaced: { label: slot.label, kind: d.kind } });
  }

  // This device lost its slot to a newer sign-in: end its session.
  if (c.accessToken) await c.svc.auth.admin.signOut(c.accessToken, 'local').catch(() => null);
  return NextResponse.json({ ok: false, reason: 'replaced', by: { label: slot.label, at: slot.at, kind: d.kind } });
}
