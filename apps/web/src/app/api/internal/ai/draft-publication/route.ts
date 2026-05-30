import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI, parseAIJson } from '@/lib/ai/client';
import {
  DRAFT_PUBLICATION_MODEL,
  buildDraftPrompt,
  getSystemForKind,
  type PublicationKind,
  type PublicItem,
  type DraftInstagramOutput,
  type DraftXOutput,
} from '@/lib/ai/prompts/draft-publication';
import { getActivePrompt } from '@/lib/ai/db-prompts';
import { logger } from '@/lib/logger';

type Body = { cycleId: string; kind: PublicationKind };

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { cycleId, kind } = (await req.json()) as Body;
  if (!cycleId || !kind) return NextResponse.json({ error: 'cycleId and kind required' }, { status: 400 });

  const validKinds: PublicationKind[] = ['social_instagram', 'social_x', 'newsletter'];
  if (!validKinds.includes(kind)) {
    return NextResponse.json(
      { error: 'Invalid kind. Use: social_instagram, social_x, newsletter' },
      { status: 400 },
    );
  }

  const consolidation = await db.query.consolidations.findFirst({
    where: eq(schema.consolidations.cycle_id, cycleId),
    columns: { id: true, internal_summary_md: true },
  });

  if (!consolidation) {
    return NextResponse.json(
      { error: 'No consolidation found for cycle. Run /consolidate first.' },
      { status: 422 },
    );
  }

  // Si ya existe una publicación de este kind para el ciclo, devolver sin regenerar
  const allPubs = await db.query.publications.findMany({
    where: eq(schema.publications.cycle_id, cycleId),
    columns: { id: true, kind: true, status: true },
  });
  const kindPub = allPubs.find(p => p.kind === kind);
  if (kindPub) {
    return NextResponse.json({ publicationId: kindPub.id, note: 'already_exists', status: kindPub.status });
  }

  // Datos del ciclo
  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, cycleId),
    columns: { iso_week: true, year: true },
  });

  // Reportes del ciclo → ítems públicos
  const reports = await db.query.reports.findMany({
    where: eq(schema.reports.cycle_id, cycleId),
    columns: { id: true, user_id: true },
  });

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
          },
        })
      : [];

  const userIds = Array.from(new Set(reports.map(r => r.user_id)));
  const users =
    userIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(schema.users.id, userIds),
          columns: { id: true, full_name: true },
        })
      : [];
  const userMap = new Map(users.map(u => [u.id, u.full_name]));
  const reportUserMap = new Map(reports.map(r => [r.id, r.user_id]));

  const publicItems: PublicItem[] = allItems
    .filter(i => i.is_public_safe)
    .map(i => ({
      category: i.category,
      title: i.title,
      description_md: i.description_md,
      priority: i.priority ?? 'medium',
      authorName: userMap.get(reportUserMap.get(i.report_id) ?? '') ?? 'Desconocido',
    }));

  const userPrompt = buildDraftPrompt({
    kind,
    consolidationMd: consolidation.internal_summary_md,
    publicItems,
    isoWeek: cycle?.iso_week ?? 0,
    year: cycle?.year ?? new Date().getFullYear(),
  });

  const dbSlug = kind === 'newsletter' ? 'draft-newsletter' : 'draft-social';
  const dbPrompt = await getActivePrompt(dbSlug);
  const systemText = dbPrompt?.system_prompt ?? getSystemForKind(kind);

  const result = await callAI({
    purpose: kind === 'newsletter' ? 'draft_newsletter' : 'draft_social',
    model: DRAFT_PUBLICATION_MODEL,
    systemBlocks: [{ text: systemText, cache: true }],
    userContent: userPrompt,
    relatedCycleId: cycleId,
    promptId: dbPrompt?.id,
  });

  // Parsear output según el kind
  let bodyMd = result.text;
  let meta: Record<string, unknown> | null = null;

  if (kind === 'social_instagram') {
    try {
      const parsed = parseAIJson<DraftInstagramOutput>(result.text);
      bodyMd = parsed.caption;
      meta = {
        hashtags: parsed.suggested_hashtags,
        visual_idea: parsed.suggested_visual_idea,
        char_count: parsed.character_count,
      };
    } catch {
      logger.warn({ raw: result.text, kind }, 'draft instagram parse error — guardando texto raw');
    }
  } else if (kind === 'social_x') {
    try {
      const parsed = parseAIJson<DraftXOutput>(result.text);
      bodyMd = parsed.tweets.map(t => t.text).join('\n\n---\n\n');
      meta = { tweets: parsed.tweets };
    } catch {
      logger.warn({ raw: result.text, kind }, 'draft x parse error — guardando texto raw');
    }
  }

  // Crear publicación
  const [publication] = await db
    .insert(schema.publications)
    .values({ cycle_id: cycleId, consolidation_id: consolidation.id, kind, status: 'draft' })
    .returning({ id: schema.publications.id });

  // Crear primera versión
  const [version] = await db
    .insert(schema.publicationVersions)
    .values({
      publication_id: publication.id,
      version_number: 1,
      body_md: bodyMd,
      meta: meta as Record<string, unknown> | null,
      source: 'ai_generated',
      created_by: null,
      ai_invocation_id: result.invocationId,
    })
    .returning({ id: schema.publicationVersions.id });

  // Actualizar current_version_id
  await db
    .update(schema.publications)
    .set({ current_version_id: version.id, updated_at: new Date() })
    .where(eq(schema.publications.id, publication.id));

  logger.info({ cycleId, kind, publicationId: publication.id, costUsd: result.costUsd }, 'draft publication generated');

  return NextResponse.json({ publicationId: publication.id, versionId: version.id, kind, costUsd: result.costUsd });
}
