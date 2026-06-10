// Página del glosario de IA.
// Solo accesible para el rol press_admin.
// Muestra las entidades (organismos, siglas, lugares) más mencionadas en los reportes
// de los últimos 90 días, con qué frecuencia aparecen y si ya están en el prompt de extracción.
// Permite agregar descripciones a los términos para que la IA los entienda mejor
// y también agregar los términos más frecuentes directamente al prompt.
import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { sql, eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { GlosarioClient } from './glosario-client';

type MentionRow = { mention: string; frequency: number };

const DESCRIPTIONS_KEY = 'glosario_descriptions';

export default async function AdminGlosarioPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  const [rows, extractPrompt, descriptionsRow] = await Promise.all([
    db.execute<MentionRow>(sql`
      SELECT mention, COUNT(*)::int AS frequency
      FROM app.report_items,
           jsonb_array_elements_text(mentions) AS mention
      WHERE created_at > NOW() - INTERVAL '90 days'
        AND mention <> ''
      GROUP BY mention
      ORDER BY frequency DESC
      LIMIT 100
    `),
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

  return <GlosarioClient mentions={mentions} />;
}
