import { DRIVER_REPORTS_ON, REPORTS_ON } from '@/lib/features';
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { ownIds } from '@/lib/company-profile';
import { isStripeConfigured } from '@/lib/stripe';
import { reporterIdentities, resolveCompany } from '@/lib/reports-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// What this account can report as: the verified company (with the roles
// FMCSA shows for it), a verified driver, a verified shipper. Also what it
// still needs to do to get there.
export async function GET() {
  if (!REPORTS_ON) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const identities = reporterIdentities(user);
  const companyId = identities.find((i) => i.kind === 'company');
  let company: any = null;
  if (companyId && companyId.kind === 'company') {
    const resolved = await resolveCompany({ mc: companyId.mc, dot: companyId.dot }).catch(() => null);
    const role = resolved?.role;
    company = {
      mc: resolved?.mc || companyId.mc,
      dot: resolved?.dot || companyId.dot,
      name: resolved?.name || (companyId.mc ? `MC-${companyId.mc}` : `DOT-${companyId.dot}`),
      verifiedBy: companyId.verifiedBy,
      at: companyId.at,
      roles: [
        ...(role === 'carrier' || role === 'both' || role === 'dot-only' ? ['carrier'] : []),
        ...(role === 'broker' || role === 'both' ? ['broker'] : []),
      ],
      lookupFailed: !resolved,
    };
  }
  const driver = identities.find((i) => i.kind === 'driver') || null;
  const shipper = identities.find((i) => i.kind === 'shipper') || null;
  const claimed = ownIds(user);
  return NextResponse.json({
    configured: Boolean(getServiceSupabase()),
    email: user.email,
    company,
    driver,
    shipper,
    // The MC/DOT on the profile, not yet proved.
    claimedCompany: !company && (claimed.mc || claimed.dot) ? claimed : null,
    driverCheckAvailable: DRIVER_REPORTS_ON && isStripeConfigured(),
  });
}
