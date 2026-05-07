import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Community fraud reports were removed to limit defamation / tortious-interference
// exposure. The endpoint stays mounted so any cached client returns a clean 410
// instead of a 500 / network error.
const GONE = NextResponse.json(
  { error: 'Community fraud reports have been retired.', code: 'feature_removed' },
  { status: 410 },
);

export async function GET() { return GONE; }
export async function POST() { return GONE; }
export async function DELETE() { return GONE; }
