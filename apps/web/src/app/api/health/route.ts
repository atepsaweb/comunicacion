import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export async function GET(): Promise<NextResponse> {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // db unreachable
  }

  const version = process.env.npm_package_version ?? 'unknown';

  return NextResponse.json({ ok: true, db: dbOk, version }, { status: dbOk ? 200 : 503 });
}
