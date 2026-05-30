import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { PromptsClient } from './prompts-client';

export default async function AdminPromptsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  const activePrompts = await db.query.prompts.findMany({
    where: eq(schema.prompts.is_active, true),
    columns: {
      id: true,
      slug: true,
      version: true,
      model_hint: true,
      system_prompt: true,
      user_template: true,
      notes: true,
      created_by: true,
      created_at: true,
    },
    orderBy: [schema.prompts.slug],
  });

  const authorIds = Array.from(new Set(
    activePrompts.map(p => p.created_by).filter((id): id is string => id !== null),
  ));

  const authors =
    authorIds.length > 0
      ? await db.query.users.findMany({
          where: (u, { inArray }) => inArray(u.id, authorIds),
          columns: { id: true, full_name: true },
        })
      : [];

  const authorMap = new Map(authors.map(a => [a.id, a.full_name]));

  const prompts = activePrompts.map(p => ({
    ...p,
    author_name: p.created_by ? (authorMap.get(p.created_by) ?? 'Desconocido') : 'Sistema',
    created_at: p.created_at.toISOString(),
  }));

  return <PromptsClient prompts={prompts} />;
}
