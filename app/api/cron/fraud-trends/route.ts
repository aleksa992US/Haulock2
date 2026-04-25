import { NextResponse } from 'next/server';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { listContacts, isAudienceConfigured } from '@/lib/resend-audience';
import { sendEmail, fraudTrendsTemplate, isResendConfigured } from '@/lib/email';
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
  const auth = await authorizeCronOrAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
  // contact in Resend.
  let recipients: string[] = [];
  if (testRecipient) {
    recipients = [testRecipient.trim().toLowerCase()];
  } else {
    const list = await listContacts(5000);
    if (!list.ok) {
      return NextResponse.json({ error: list.error || 'Resend list failed' }, { status: 500 });
    }
    recipients = list.contacts.filter((c) => !c.unsubscribed && c.email).map((c) => c.email);
  }

  console.log('[cron/fraud-trends] sending to', { count: recipients.length });

  let sent = 0;
  let failed = 0;
  // Sequential sends so we don't get rate-limited by Resend (free tier:
  // 2/sec). For huge lists this would need batching, but Haulock is small.
  for (const email of recipients) {
    try {
      const { subject, html } = fraudTrendsTemplate({
        title: article.title,
        preview: article.preview,
        bodyHtml: article.bodyHtml,
        sources: article.sources,
        recipientEmail: email,
        siteUrl,
      });
      await sendEmail({ to: email, subject, html, kind: 'newsletter' });
      sent += 1;
      // Polite spacing — 600ms keeps us well under Resend's free-tier limit.
      await new Promise((r) => setTimeout(r, 600));
    } catch (err: any) {
      failed += 1;
      console.warn('[cron/fraud-trends] send failed', { email, message: err?.message });
    }
  }

  return NextResponse.json({
    ok: true,
    topic,
    title: article.title,
    sources: article.sources.length,
    sent,
    failed,
    totalRecipients: recipients.length,
  });
}
