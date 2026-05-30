import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';

// GET /api/admin/prompts/[slug] — versión activa + historial
export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { slug } = params;

  const versions = await db.query.prompts.findMany({
    where: eq(schema.prompts.slug, slug),
    orderBy: [schema.prompts.version],
  });

  if (versions.length === 0) {
    return NextResponse.json({ error: 'Slug no encontrado' }, { status: 404 });
  }

  const active = versions.find(v => v.is_active) ?? null;

  // Enriquecer con nombre del autor
  const authorIds = Array.from(new Set(
    versions.map(v => v.created_by).filter((id): id is string => id !== null),
  ));

  const authors =
    authorIds.length > 0
      ? await db.query.users.findMany({
          where: (users, { inArray }) => inArray(users.id, authorIds),
          columns: { id: true, full_name: true },
        })
      : [];

  const authorMap = new Map(authors.map(a => [a.id, a.full_name]));

  const versionsWithAuthor = versions.map(v => ({
    ...v,
    author_name: v.created_by ? (authorMap.get(v.created_by) ?? 'Desconocido') : 'Sistema',
  }));

  return NextResponse.json({ slug, active, versions: versionsWithAuthor });
}
