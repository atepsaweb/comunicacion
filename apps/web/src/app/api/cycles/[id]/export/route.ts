// Endpoint para exportar el resumen individual de cada secretario como .docx.
// Genera un documento con una sección por secretario, con sus ítems de reporte.
// Usa reportItems (el mismo origen que la consolidación), NO summary_md.
// Solo accesible para press_admin.
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { markdownToDocx } from '@/lib/export/markdown-to-docx';

const NO_CONTENT_LABEL: Record<string, string> = {
  no_report: 'No presentó reporte esta semana.',
  paused:    'Pausa esta semana.',
  on_leave:  'Licencia esta semana.',
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
            inArray(schema.reports.user_id, users.map(u => u.id)),
          ),
          columns: { id: true, user_id: true, status: true },
        })
      : [];

  // Leer ítems de todos los reportes de una vez
  const reportIds = reports.map(r => r.id);
  const allItems =
    reportIds.length > 0
      ? await db.query.reportItems.findMany({
          where: inArray(schema.reportItems.report_id, reportIds),
          columns: {
            report_id: true,
            category: true,
            title: true,
            description_md: true,
            priority: true,
            order_index: true,
          },
          orderBy: [schema.reportItems.order_index],
        })
      : [];

  const reportById = new Map(reports.map(r => [r.user_id, r]));
  const itemsByReport = new Map<string, typeof allItems>();
  for (const item of allItems) {
    if (!itemsByReport.has(item.report_id)) itemsByReport.set(item.report_id, []);
    itemsByReport.get(item.report_id)!.push(item);
  }

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

    const report = reportById.get(user.id);

    if (!report) {
      lines.push('*Sin reporte registrado.*', '', '---', '');
      continue;
    }

    const items = itemsByReport.get(report.id) ?? [];

    if (items.length === 0) {
      const label = NO_CONTENT_LABEL[report.status] ?? 'Sin ítems reportados esta semana.';
      lines.push(`*${label}*`, '', '---', '');
      continue;
    }

    // Agrupar ítems por categoría
    const byCategory = new Map<string, typeof items>();
    for (const item of items) {
      if (!byCategory.has(item.category)) byCategory.set(item.category, []);
      byCategory.get(item.category)!.push(item);
    }

    for (const [category, catItems] of Array.from(byCategory)) {
      lines.push(`### ${category}`, '');
      for (const item of catItems) {
        const prioTag = item.priority === 'high' ? ' *(alta prioridad)*' : '';
        lines.push(`- **${item.title}**${prioTag}`);
        if (item.description_md) {
          // Indentar descripción como sub-bullet
          for (const descLine of item.description_md.split('\n')) {
            if (descLine.trim()) lines.push(`  ${descLine}`);
          }
        }
        lines.push('');
      }
    }

    lines.push('---', '');
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
