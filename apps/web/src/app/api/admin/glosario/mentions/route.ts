import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

const DESCRIPTIONS_KEY = 'glosario_descriptions';

type MentionRow = { mention: string; frequency: number };

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await db.execute<MentionRow>(sql`
    SELECT mention, COUNT(*)::int AS frequency
    FROM app.report_items,
         jsonb_array_elements_text(mentions) AS mention
    WHERE created_at > NOW() - INTERVAL '90 days'
      AND mention <> ''
    GROUP BY mention
    ORDER BY frequency DESC
    LIMIT 100
  `);

  const [extractPrompt, descriptionsRow] = await Promise.all([
    db.query.prompts.findFirst({
      where: (p, { and, eq: eqFn }) => and(eqFn(p.slug, 'extract-report'), eqFn(p.is_active, true)),
      columns: { system_prompt: true },
    }),
    db.query.systemSettings.findFirst({
      where: eq(schema.systemSettings.key, DESCRIPTIONS_KEY),
      columns: { value: true },
    }),
  ]);

  const promptText = (extractPrompt?.system_prompt ?? '').toLowerCase();
  const descriptions = (descriptionsRow?.value ?? {}) as Record<string, string>;

  const mentions = rows.rows.map(r => ({
    term: r.mention,
    frequency: r.frequency,
    alreadyInPrompt: promptText.includes(r.mention.toLowerCase()),
    description: descriptions[r.mention] ?? '',
  }));

  return NextResponse.json({ mentions });
}
