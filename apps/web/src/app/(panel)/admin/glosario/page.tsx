import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import { GlosarioClient } from './glosario-client';

type MentionRow = { mention: string; frequency: number };

export default async function AdminGlosarioPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

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

  const extractPrompt = await db.query.prompts.findFirst({
    where: (p, { and, eq }) => and(eq(p.slug, 'extract-report'), eq(p.is_active, true)),
    columns: { system_prompt: true },
  });

  const promptText = (extractPrompt?.system_prompt ?? '').toLowerCase();

  const mentions = rows.rows.map(r => ({
    term: r.mention,
    frequency: r.frequency,
    alreadyInPrompt: promptText.includes(r.mention.toLowerCase()),
  }));

  return <GlosarioClient mentions={mentions} />;
}
