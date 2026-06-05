// Endpoint de consolidación: genera el resumen semanal unificado de todos los reportes.
// Solo puede llamarse cuando el ciclo está cerrado.
// El proceso:
//   1. Lee todos los reportes y sus ítems del ciclo
//   2. Calcula las métricas de participación (cuántos reportaron, licencias, pausas)
//   3. Prepara el prompt con todos los datos estructurados por autor
//   4. Llama a Sonnet (el modelo más potente) para generar el Markdown del consolidado
//   5. Guarda el consolidado en la base de datos y marca el ciclo como 'processed'
// Si ya existe un consolidado para ese ciclo, devuelve el existente sin regenerar.
import { NextRequest, NextResponse } from 'next/server';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI } from '@/lib/ai/client';
import {
  CONSOLIDATE_INTERNAL_SYSTEM,
  CONSOLIDATE_INTERNAL_MODEL,
  buildConsolidatePrompt,
  type ConsolidateInput,
} from '@/lib/ai/prompts/consolidate-internal';
import { getActivePrompt } from '@/lib/ai/db-prompts';
import { logger } from '@/lib/logger';

type Body = { cycleId: string };

function apellidoInicial(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const apellido = parts[0] ?? 'Desconocido';
  const ultimo = parts[parts.length - 1] ?? '';
  const inicial = parts.length > 1 ? ultimo[0] ?? '?' : '?';
  return `${apellido}, ${inicial}.`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { cycleId } = (await req.json()) as Body;
  if (!cycleId) return NextResponse.json({ error: 'cycleId required' }, { status: 400 });

  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, cycleId),
    columns: { id: true, status: true, iso_week: true, year: true, starts_at: true, ends_at: true },
  });

  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  // Si ya existe consolidación, devolver sin regenerar.
  // Nota: el endpoint /cycles/:id/process limpia el consolidado antes de llamar acá,
  // por lo que este guard aplica solo a llamadas directas (ej: desde el job de cierre).
  const existing = await db.query.consolidations.findFirst({
    where: eq(schema.consolidations.cycle_id, cycleId),
    columns: { id: true, status: true },
  });
  if (existing) {
    return NextResponse.json({ consolidationId: existing.id, note: 'already_exists', status: existing.status });
  }

  // Leer todos los reportes del ciclo
  const reports = await db.query.reports.findMany({
    where: eq(schema.reports.cycle_id, cycleId),
    columns: { id: true, user_id: true, status: true },
  });

  // Leer ítems de todos los reportes en una sola query
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
            is_public_safe: true,
            order_index: true,
          },
        })
      : [];

  // Leer usuarios de los reportes
  const userIds = Array.from(new Set(reports.map(r => r.user_id)));
  const users =
    userIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(schema.users.id, userIds),
          columns: { id: true, full_name: true },
        })
      : [];

  const userMap = new Map(users.map(u => [u.id, u.full_name]));
  const itemsByReport = new Map<string, typeof allItems>();
  for (const item of allItems) {
    if (!itemsByReport.has(item.report_id)) itemsByReport.set(item.report_id, []);
    itemsByReport.get(item.report_id)!.push(item);
  }

  // Métricas: total de secretarios activos
  const activeUsers = await db.query.users.findMany({
    where: and(eq(schema.users.is_active, true)),
    columns: { id: true, full_name: true, role: true },
  });
  const activeSecretaries = activeUsers.filter(u => u.role === 'secretary' || u.role === 'executive');
  const totalActive = activeSecretaries.length;

  const reported = reports.filter(r => (itemsByReport.get(r.id)?.length ?? 0) > 0).length;
  const onLeave = reports.filter(r => r.status === 'on_leave').length;
  const paused = reports.filter(r => r.status === 'paused').length;
  const noReportCount = Math.max(0, totalActive - reported - onLeave - paused);

  // Secretarios sin reporte en este ciclo
  const reportedUserIds = new Set(
    reports.filter(r => (itemsByReport.get(r.id)?.length ?? 0) > 0).map(r => r.user_id),
  );
  const cycleUserIds = new Set(reports.map(r => r.user_id));
  const noReportAuthors = [
    ...activeSecretaries
      .filter(u => !reportedUserIds.has(u.id) && !cycleUserIds.has(u.id))
      .map(u => (u.full_name.split(/\s+/)[0] ?? u.full_name)),
    ...reports
      .filter(r => r.status === 'no_report')
      .map(r => {
        const name = userMap.get(r.user_id) ?? 'Desconocido';
        return name.split(/\s+/)[0] ?? name;
      }),
  ];

  const consolidateInput: ConsolidateInput = {
    cycle: {
      isoWeek: cycle.iso_week,
      year: cycle.year,
      startsAt: cycle.starts_at.toISOString(),
      endsAt: cycle.ends_at.toISOString(),
    },
    metrics: { totalActive, reported, onLeave, paused, noReport: noReportCount },
    reports: reports
      .filter(r => (itemsByReport.get(r.id)?.length ?? 0) > 0)
      .map(r => {
        const fullName = userMap.get(r.user_id) ?? 'Desconocido';
        const items = (itemsByReport.get(r.id) ?? []).sort((a, b) => a.order_index - b.order_index);
        return {
          authorName: fullName,
          authorInitial: apellidoInicial(fullName),
          status: r.status,
          items: items.map(i => ({
            category: i.category,
            title: i.title,
            description_md: i.description_md,
            priority: i.priority ?? 'medium',
            is_public_safe: i.is_public_safe,
          })),
        };
      }),
    noReportAuthors,
  };

  const dbPrompt = await getActivePrompt('consolidate-internal');
  const systemText = dbPrompt?.system_prompt ?? CONSOLIDATE_INTERNAL_SYSTEM;

  const result = await callAI({
    purpose: 'consolidate',
    model: CONSOLIDATE_INTERNAL_MODEL,
    systemBlocks: [{ text: systemText, cache: true }],
    userContent: buildConsolidatePrompt(consolidateInput),
    maxTokens: 8192,
    relatedCycleId: cycleId,
    promptId: dbPrompt?.id,
  });

  // Árbol temático para el campo themes
  const themes: Record<string, Array<{ title: string; contributors: string[] }>> = {};
  for (const r of reports.filter(r => (itemsByReport.get(r.id)?.length ?? 0) > 0)) {
    for (const item of itemsByReport.get(r.id) ?? []) {
      if (!themes[item.category]) themes[item.category] = [];
      const node = themes[item.category].find(t => t.title === item.title);
      if (node) {
        node.contributors.push(r.user_id);
      } else {
        themes[item.category].push({ title: item.title, contributors: [r.user_id] });
      }
    }
  }

  const metrics = {
    total_users: totalActive,
    reported,
    on_leave: onLeave,
    paused,
    no_report: noReportCount,
    by_category: Object.fromEntries(
      Object.entries(themes).map(([cat, items]) => [cat, items.length]),
    ),
  };

  const [consolidation] = await db
    .insert(schema.consolidations)
    .values({
      cycle_id: cycleId,
      internal_summary_md: result.text,
      themes: themes as unknown as Record<string, unknown>,
      metrics: metrics as unknown as Record<string, unknown>,
      generated_at: new Date(),
      status: 'draft',
    })
    .returning({ id: schema.consolidations.id });

  // Solo avanza el estado si el ciclo ya estaba cerrado (el cierre lo hace el job programado)
  if (cycle.status === 'closed') {
    await db
      .update(schema.weeklyCycles)
      .set({ status: 'processed', processed_at: new Date(), updated_at: new Date() })
      .where(eq(schema.weeklyCycles.id, cycleId));
  }

  logger.info(
    { cycleId, consolidationId: consolidation.id, costUsd: result.costUsd },
    'consolidation generated',
  );

  return NextResponse.json({ consolidationId: consolidation.id, metrics, costUsd: result.costUsd });
}
