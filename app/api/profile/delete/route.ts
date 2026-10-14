import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { removeContact, isAudienceConfigured } from '@/lib/resend-audience';
import { getStripe } from '@/lib/stripe';
import { cancelLiveHaulockSubscriptions, ownedCustomerId } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  // Cancel their Haulock subscription before anything is deleted. Deleting
  // only the login left Stripe charging people for an account that was gone.
  const stripe = getStripe();
  if (stripe) {
    try {
      // Only this user's own customer (the stored id is user-editable); the
      // email lookup covers customers created before the id was saved.
      await cancelLiveHaulockSubscriptions(stripe, { customerId: await ownedCustomerId(stripe, me), email: me.email });
    } catch (err: any) {
      console.error('[api/profile/delete] stripe cancel failed:', err?.message);
      return NextResponse.json({ error: "We couldn't cancel your subscription, so your account was not deleted. Please try again or contact support." }, { status: 502 });
    }
  }

  // Best-effort cleanup of rows the user owns. Most tables have
  // ON DELETE CASCADE against auth.users, so deleting the auth user
  // is enough — but we scrub explicitly in case cascades are missing
  // or the user owns a team that isn't cascaded.
  try {
    await svc.from('lookups').delete().eq('user_id', me.id);
    await svc.from('watchlist').delete().eq('user_id', me.id);
    await svc.from('team_members').delete().eq('user_id', me.id);
    await svc.from('teams').delete().eq('owner_user_id', me.id);
  } catch (err) {
    console.warn('[api/profile/delete] cleanup warnings:', err);
  }

  // Hard-remove from the Resend Audience so the deleted user stops
  // receiving any future newsletter sends. Best-effort.
  if (isAudienceConfigured() && me.email) {
    try { await removeContact(me.email); }
    catch (err) { console.warn('[api/profile/delete] resend remove failed:', err); }
  }

  const { error } = await svc.auth.admin.deleteUser(me.id);
  if (error) {
    console.error('[api/profile/delete] auth delete failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
