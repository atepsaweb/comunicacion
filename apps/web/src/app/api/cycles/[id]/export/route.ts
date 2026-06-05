// Endpoint para exportar el resumen individual de cada secretario como .docx.
// Genera un documento con una sección por secretario, con su reporte de la semana.
// Solo accesible para press_admin.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { markdownToDocx } from '@/lib/export/markdown-to-docx';

const STATUS_LABEL: Record<string, string> = {
  no_report: 'No presentó reporte esta semana.',
  paused:    'Pausa esta semana.',
  on_leave:  'Licencia esta semana.',
  draft:     'Reporte en borrador (sin procesar aún).',
  submitted: 'Reporte recibido (sin procesar aún).',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'press_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cycleId = params.id;

  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, cycleId),
    columns: { id: true, iso_week: true, year: true, starts_at: true, ends_at: true },
  });

  if (!cycle) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const users = await db.query.users.findMany({
    where: and(
      eq(schema.users.is_active, true),
      inArray(schema.users.role, ['secretary', 'executive']),
    ),
    columns: { id: true, full_name: true, position: true },
    orderBy: [schema.users.full_name],
  });

  const reports =
    users.length > 0
      ? await db.query.reports.findMany({
          where: and(
            eq(schema.reports.cycle_id, cycleId),
            inArray(
              schema.reports.user_id,
              users.map(u => u.id),
            ),
          ),
          columns: { user_id: true, status: true, summary_md: true },
        })
      : [];

  const reportMap = new Map(reports.map(r => [r.user_id, r]));

  // ─── Construir el Markdown del documento ────────────────────────────────────

  const startDate = cycle.starts_at.toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const endDate = cycle.ends_at.toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  const lines: string[] = [
    `# Reportes individuales · Semana ${cycle.iso_week}/${cycle.year}`,
    '',
    `*${startDate} al ${endDate} · Secretariado Nacional ATEPSA*`,
    '',
    '---',
    '',
  ];

  for (const user of users) {
    const heading = user.position
      ? `## ${user.full_name} · ${user.position}`
      : `## ${user.full_name}`;
    lines.push(heading, '');

    const report = reportMap.get(user.id);

    if (!report) {
      lines.push('*Sin reporte registrado.*', '', '---', '');
      continue;
    }

    if (report.summary_md) {
      lines.push(report.summary_md, '', '---', '');
    } else {
      const label = STATUS_LABEL[report.status] ?? 'Sin contenido disponible.';
      lines.push(`*${label}*`, '', '---', '');
    }
  }

  const markdown = lines.join('\n');
  const title = `ATEPSA — Reportes individuales Semana ${cycle.iso_week}/${cycle.year}`;

  const buffer = await markdownToDocx(markdown, title);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const filename = `ATEPSA-reportes-individuales-semana-${cycle.iso_week}-${cycle.year}.docx`;

  return new NextResponse(arrayBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
