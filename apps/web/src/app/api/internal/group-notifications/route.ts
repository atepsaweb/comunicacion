/**
 * GET /api/internal/group-notifications?type=thursday|friday|monday
 *
 * Devuelve el mensaje a enviar al grupo de WhatsApp para cada día del ciclo.
 * Si no corresponde enviar nada, responde { send: false }.
 *
 * Toda la lógica de negocio vive aquí; n8n solo llama este endpoint
 * y si send=true manda el texto a WAHA.
 *
 * Settings requeridas en system_settings:
 *   whatsapp_group_jid              → JID del grupo (ej: "120363xxx@g.us")
 *   group_notification_last_cycle_id → UUID del último ciclo notificado el lunes
 */
import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { logger } from '@/lib/logger';

type NotificationType = 'thursday' | 'friday' | 'monday';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(schema.systemSettings.key, key),
    columns: { value: true },
  });
  if (!row) return null;
  const val = row.value;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'value' in val) return String((val as { value: unknown }).value);
  return String(val);
}

async function upsertSetting(key: string, value: string): Promise<void> {
  await db
    .insert(schema.systemSettings)
    .values({ key, value: value as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: schema.systemSettings.key,
      set: {
        value: value as unknown as Record<string, unknown>,
        updated_at: new Date(),
      },
    });
}

/**
 * Conversión básica markdown → formato WhatsApp.
 * WhatsApp acepta: *negrita*, _cursiva_, saltos de línea.
 */
function mdToWa(md: string): string {
  return md
    // Encabezados → negrita + mayúsculas
    .replace(/^#{1,2} (.+)$/gm, (_, t: string) => `*${t.toUpperCase()}*`)
    .replace(/^#{3,6} (.+)$/gm, (_, t: string) => `*${t}*`)
    // Negritas **text** o __text__ → *text*
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    // Cursivas *text* (no confundir con negritas ya procesadas) → _text_
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_')
    // Viñetas - o * al inicio de línea → •
    .replace(/^[-*] /gm, '• ')
    // Líneas horizontales
    .replace(/^---+$/gm, '─────────────────────')
    .trim();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

// ─── Handlers por tipo ────────────────────────────────────────────────────────

async function handleThursdayOrFriday(
  type: 'thursday' | 'friday',
  groupJid: string,
): Promise<NextResponse> {
  // Buscar ciclo abierto actual
  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.status, 'open'),
    orderBy: [desc(schema.weeklyCycles.starts_at)],
    columns: { id: true, iso_week: true, year: true, closes_at: true },
  });

  if (!cycle) {
    logger.info({ type }, 'group-notification: no open cycle, skipping');
    return NextResponse.json({ send: false, reason: 'no open cycle' });
  }

  const cierraEl = formatDate(cycle.closes_at);

  const text =
    type === 'thursday'
      ? `📋 *Semana ${cycle.iso_week}/${cycle.year} — recordatorio de reporte*

El ciclo está abierto. Si tenés novedades de la semana, mandá tu reporte al número del bot.

El ciclo cierra el ${cierraEl}.`
      : `⚠️ *Último recordatorio — Semana ${cycle.iso_week}/${cycle.year}*

El ciclo cierra hoy. Si todavía no reportaste, es el momento.

Escribile directamente al bot con tus novedades o respondé "esta semana paso" si no tenés.`;

  logger.info({ type, cycleId: cycle.id, isoWeek: cycle.iso_week }, 'group-notification: sending');

  return NextResponse.json({ send: true, chatId: groupJid, text });
}

async function handleMonday(groupJid: string): Promise<NextResponse> {
  // Consolidación aprobada o marcada como enviada más reciente
  const consolidation = await db.query.consolidations.findFirst({
    where: inArray(schema.consolidations.status, ['approved', 'sent']),
    orderBy: [desc(schema.consolidations.generated_at)],
    columns: {
      id: true,
      cycle_id: true,
      internal_summary_md: true,
      status: true,
    },
  });

  if (!consolidation) {
    logger.info('group-notification monday: no approved consolidation, skipping');
    return NextResponse.json({ send: false, reason: 'no approved consolidation' });
  }

  // Verificar que no se haya enviado ya esta semana
  const lastNotifiedCycleId = await getSetting('group_notification_last_cycle_id');
  if (lastNotifiedCycleId === consolidation.cycle_id) {
    logger.info(
      { cycleId: consolidation.cycle_id },
      'group-notification monday: already notified this cycle, skipping',
    );
    return NextResponse.json({ send: false, reason: 'already notified this cycle' });
  }

  // Obtener datos del ciclo para el encabezado
  const cycle = await db.query.weeklyCycles.findFirst({
    where: eq(schema.weeklyCycles.id, consolidation.cycle_id),
    columns: { iso_week: true, year: true, starts_at: true, ends_at: true },
  });

  const weekLabel = cycle
    ? `Semana ${cycle.iso_week}/${cycle.year}`
    : 'Semana';

  const dateRange = cycle
    ? `${formatDate(cycle.starts_at)} al ${formatDate(cycle.ends_at)}`
    : '';

  const summaryFormatted = mdToWa(consolidation.internal_summary_md);

  const text = `📄 *Consolidado interno — ${weekLabel}*
_${dateRange}_

${summaryFormatted}`;

  // Marcar como notificado ANTES de responder (idempotente si n8n reintenta)
  await upsertSetting('group_notification_last_cycle_id', consolidation.cycle_id);

  logger.info(
    { cycleId: consolidation.cycle_id, isoWeek: cycle?.iso_week },
    'group-notification monday: sending consolidado',
  );

  return NextResponse.json({ send: true, chatId: groupJid, text });
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get('type') as NotificationType | null;
  if (!type || !['thursday', 'friday', 'monday'].includes(type)) {
    return NextResponse.json(
      { error: 'type must be thursday, friday or monday' },
      { status: 400 },
    );
  }

  // JID del grupo — requerido para todo
  const groupJid = await getSetting('whatsapp_group_jid');
  if (!groupJid) {
    logger.warn({ type }, 'group-notification: whatsapp_group_jid not configured');
    return NextResponse.json({ send: false, reason: 'group JID not configured' });
  }

  if (type === 'monday') return handleMonday(groupJid);
  return handleThursdayOrFriday(type, groupJid);
}
