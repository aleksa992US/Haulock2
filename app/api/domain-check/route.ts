import { NextResponse } from 'next/server';
import { checkDomain } from '@/lib/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  if (!q.trim()) return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  const result = await checkDomain(q);
  return NextResponse.json(result);
}
