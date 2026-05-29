import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { markdownToDocx } from '@/lib/export/markdown-to-docx';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const consolidation = await db.query.consolidations.findFirst({
    where: eq(schema.consolidations.id, params.id),
    columns: { id: true, internal_summary_md: true, cycle_id: true },
  });

  if (!consolidation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Obtener info del ciclo para el nombre del archivo
  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, consolidation.cycle_id),
    columns: { iso_week: true, year: true },
  });

  const semana = cycle ? `semana-${cycle.iso_week}-${cycle.year}` : 'consolidado';
  const filename = `ATEPSA-${semana}.docx`;
  const title = `ATEPSA Secretariado — Semana ${cycle?.iso_week}/${cycle?.year}`;

  const buffer = await markdownToDocx(consolidation.internal_summary_md, title);
  // Next.js Response body acepta ArrayBuffer pero no Node Buffer directamente
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  return new NextResponse(arrayBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
