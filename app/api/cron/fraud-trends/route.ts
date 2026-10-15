import { NextResponse } from 'next/server';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { listContacts, isAudienceConfigured } from '@/lib/resend-audience';
import { fraudTrendsTemplate, isResendConfigured, recentlySentTo, sendEmailBatch } from '@/lib/email';
import { getServiceSupabase } from '@/lib/supabase/service';
import { pickWeekTopic, searchFraudNews, generateFraudArticle } from '@/lib/news-research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Generating the article + sending to many contacts can take a while —
// give Vercel up to 5 minutes (the platform max for serverless cron).
export const maxDuration = 300;

// Weekly fraud-trends newsletter. Pulls fresh fraud-related news from
// Brave, has Claude write a short briefing, and sends it to every
// subscribed Resend contact. Designed to run from Vercel Cron every
// Thursday morning, but can also be triggered manually by an admin via
// `POST /api/cron/fraud-trends?dryRun=1` to preview the article without
// sending.
export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}

async function run(req: Request) {
  const denied = await authorizeCronOrAdmin(req);
  if (denied) return denied;

  if (!isResendConfigured() || !isAudienceConfigured()) {
    return NextResponse.json({ error: 'Resend not configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const overrideTopic = url.searchParams.get('topic');
  const testRecipient = url.searchParams.get('to'); // send only to this email when set

  const topic = overrideTopic || pickWeekTopic();
  console.log('[cron/fraud-trends] starting', { topic, dryRun, testRecipient: !!testRecipient });

  const sources = await searchFraudNews(topic, { maxResults: 10, freshness: 'pm' });
  console.log('[cron/fraud-trends] sources found', { count: sources.length });

  const article = await generateFraudArticle(topic, sources);
  if (!article) {
    return NextResponse.json({ error: 'Article generation failed (check ANTHROPIC_API_KEY).' }, { status: 500 });
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, topic, article });
  }

  const { getEmailSiteUrl } = await import('@/lib/email');
  const siteUrl = getEmailSiteUrl();

  // Recipient set: either a single test address (for QA) or every subscribed
  // contact in Resend — minus account-level opt-outs (Settings, or an
  // unsubscribe link at a time Resend's contact couldn't be updated) and
  // anyone who already got this week's issue (a re-run or retry).
  let recipients: string[] = [];
  let skippedOptOut = 0;
  let skippedAlreadySent = 0;
  if (testRecipient) {
    recipients = [testRecipient.trim().toLowerCase()];
  } else {
    const list = await listContacts(5000);
    if (!list.ok) {
      return NextResponse.json({ error: list.error || 'Resend list failed' }, { status: 500 });
    }
    const optedOut = await accountOptOuts();
    const already = await recentlySentTo('fraud_trends', new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString());
    for (const c of list.contacts) {
      const email = String(c.email || '').trim().toLowerCase();
      if (!email || c.unsubscribed) continue;
      if (optedOut.has(email)) { skippedOptOut += 1; continue; }
      if (already.has(email)) { skippedAlreadySent += 1; continue; }
      recipients.push(email);
    }
  }

  console.log('[cron/fraud-trends] sending to', { count: recipients.length, skippedOptOut, skippedAlreadySent });

  const { sent, failed, errors } = await sendEmailBatch(recipients.map((email) => {
    const { subject, html } = fraudTrendsTemplate({
      title: article.title,
      preview: article.preview,
      bodyHtml: article.bodyHtml,
      sources: article.sources,
      recipientEmail: email,
      siteUrl,
    });
    return { to: email, subject, html, kind: 'fraud_trends' as const };
  }));
  if (errors.length) console.warn('[cron/fraud-trends] batch errors', errors.slice(0, 3));

  return NextResponse.json({
    ok: true,
    topic,
    title: article.title,
    sources: article.sources.length,
    sent,
    failed,
    skippedOptOut,
    skippedAlreadySent,
    totalRecipients: recipients.length,
  });
}

// Addresses (login or notification email) whose account has the newsletter
// turned off.
async function accountOptOuts(): Promise<Set<string>> {
  const out = new Set<string>();
  const svc = getServiceSupabase();
  if (!svc) return out;
  for (let page = 1; ; page += 1) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const batch = data?.users || [];
    for (const u of batch) {
      const meta: any = u.user_metadata || {};
      if (meta.notify_fraud_trends !== false) continue;
      if (u.email) out.add(u.email.toLowerCase());
      if (typeof meta.notification_email === 'string' && meta.notification_email.trim()) out.add(meta.notification_email.trim().toLowerCase());
    }
    if (batch.length < 1000) return out;
  }
}
