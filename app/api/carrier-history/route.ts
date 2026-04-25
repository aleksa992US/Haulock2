import { NextResponse } from 'next/server';
import { getCarrierHistory } from '@/lib/carrier-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dot = searchParams.get('dot') || undefined;
  const mc = searchParams.get('mc') || undefined;
  const limit = Number(searchParams.get('limit')) || 25;
  if (!dot && !mc) {
    return NextResponse.json({ error: 'Missing dot or mc' }, { status: 400 });
  }
  const history = await getCarrierHistory({ dot, mc, limit });
  return NextResponse.json({ history, count: history.length });
}
