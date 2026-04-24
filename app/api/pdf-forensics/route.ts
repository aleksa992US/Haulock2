import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { analyzePdfForensics } from '@/lib/pdf-forensics';
import { monthStart } from '@/lib/plans';
import { resolveTeamContext } from '@/lib/teams';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB

export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Plan-based quota (admins bypass). Free = 3/mo, paid tiers = unlimited.
  if (!(await isAdmin(user.email))) {
    const ctx = await resolveTeamContext(user.id, user.user_metadata?.plan);
    const plan = ctx.effectivePlan;
    const cap = plan.limits.pdfForensics;
    if (cap != null) {
      const svc = getServiceSupabase();
      if (svc) {
        let countableIds: string[] = [user.id];
        if (ctx.team) {
          const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', ctx.team.id);
          countableIds = (members || []).map((m: any) => m.user_id);
        }
        const since = monthStart().toISOString();
        const { count } = await svc
          .from('lookups')
          .select('id', { count: 'exact', head: true })
          .in('user_id', countableIds)
          .eq('source', 'forensics')
          .gte('created_at', since);
        if ((count ?? 0) >= cap) {
          return NextResponse.json(
            {
              error: `Your ${ctx.team ? 'team' : 'account'} has used all ${cap} PDF forensic checks on the ${plan.label} plan this month. Upgrade for unlimited scans.`,
              code: 'limit_reached', plan: plan.id, limit: cap, used: count ?? 0,
            },
            { status: 402 },
          );
        }
      }
    }
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const mime = file.type || '';
  if (!/^application\/pdf\b/i.test(mime)) {
    return NextResponse.json({ error: 'Only PDFs can be forensically analyzed — JPG/PNG images have no metadata to inspect.' }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: `File too large (${Math.round(file.size / 1024 / 1024)} MB). Maximum 15 MB.` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const result = await analyzePdfForensics(buffer);

    // Record usage against monthly quota. Reuses the `lookups` table with
    // source='forensics' so usage stats naturally fold into existing counters.
    try {
      await supabase.from('lookups').insert({
        user_id: user.id,
        query: file.name || 'pdf-forensics',
        name: 'PDF forensic scan',
        mc: null,
        dot: null,
        score: result.score,
        verdict: result.verdict === 'likely_tampered' ? 'high' : result.verdict === 'suspicious' ? 'medium' : 'low',
        source: 'forensics',
        data: { filename: file.name, ...result },
      });
    } catch { /* usage logging non-fatal */ }

    return NextResponse.json({
      ...result,
      filename: file.name,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message?.includes('encrypted')
          ? 'This PDF is password-protected. Remove the password and try again.'
          : `Couldn't parse this PDF: ${err?.message || 'unknown error'}` },
      { status: 422 },
    );
  }
}
