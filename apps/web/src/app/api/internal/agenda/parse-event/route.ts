// Endpoint para parsear un mensaje de creación de evento (intent='event_create').
// n8n lo llama cuando classify-intent devuelve 'event_create'.
//
// Flujo:
//   1. Resuelve el texto del mensaje (texto directo o transcripción de audio)
//   2. Llama a Haiku para extraer título, fecha, tipo, lugar, etc.
//   3. Si la confianza es baja o falta la fecha → pide aclaración y termina sin crear evento
//   4. Crea el evento con status='pending_confirmation'
//   5. Envía un mensaje interactivo con los datos parseados y botones [Sí / Editar / Cancelar]
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { validateInternalSecret } from '@/lib/internal-auth';
import { callAI, parseAIJson } from '@/lib/ai/client';
import {
  PARSE_EVENT_SYSTEM,
  PARSE_EVENT_MODEL,
  buildParseEventPrompt,
  REMINDER_DEFAULTS,
  type ParseEventOutput,
  type ReminderConfig,
} from '@/lib/ai/prompts/parse-event';
import { getActivePrompt } from '@/lib/ai/db-prompts';
import { sendWhatsAppInteractive, sendWhatsAppText } from '@/lib/whatsapp';
import { logger } from '@/lib/logger';

type Body = { messageId: string };

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

const ART_TZ = 'America/Argentina/Buenos_Aires';

/** Fecha actual en ART como YYYY-MM-DD */
function todayART(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ART_TZ }); // sv-SE = YYYY-MM-DD
}

/** Nombre del día de la semana en español, en ART */
function dayOfWeekART(): string {
  return new Date().toLocaleDateString('es-AR', { timeZone: ART_TZ, weekday: 'long' });
}

/** Formatea un ISO datetime para el mensaje de WhatsApp. */
function formatDateForMessage(isoString: string, allDay: boolean): string {
  const date = new Date(isoString);
  const datePart = date.toLocaleDateString('es-AR', {
    timeZone: ART_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const capitalized = datePart.charAt(0).toUpperCase() + datePart.slice(1);

  if (allDay) return capitalized;

  const timePart = date.toLocaleTimeString('es-AR', {
    timeZone: ART_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${capitalized}, ${timePart} hs`;
}

const TYPE_LABELS: Record<string, string> = {
  personal: 'Personal',
  secretariat: 'Online 💻',
  mobilization: 'Presencial 📍',
};

// ─── Resolución de acompañantes mencionados ───────────────────────────────────

/** Normaliza para comparar: minúsculas y sin tildes. */
function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

type ResolvedAttendee = { userId: string; fullName: string };
type AttendeeResolution = {
  resolved: ResolvedAttendee[];
  unresolved: string[]; // nombres que no matchearon o matchearon a más de uno
};

/**
 * Matchea los nombres mencionados contra los usuarios activos del sistema.
 * Un nombre resuelve si matchea exactamente UN usuario (por nombre, apellido o
 * nombre completo, sin tildes). Ambiguo o sin match → queda en unresolved.
 */
async function resolveMentionedAttendees(
  names: string[],
  creatorId: string,
): Promise<AttendeeResolution> {
  if (names.length === 0) return { resolved: [], unresolved: [] };

  const activeUsers = await db
    .select({ id: schema.users.id, full_name: schema.users.full_name })
    .from(schema.users)
    .where(and(
      eq(schema.users.is_active, true),
      isNull(schema.users.deleted_at),
      ne(schema.users.id, creatorId),
    ));

  const resolved: ResolvedAttendee[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const rawName of names) {
    const needle = normalizeName(rawName);
    if (!needle) continue;

    const matches = activeUsers.filter(u => {
      const full = normalizeName(u.full_name);
      if (full === needle) return true;
      // Match por palabra completa: "matias" matchea "Matías Pérez" pero no "Matilde"
      const words = full.split(/\s+/);
      const needleWords = needle.split(/\s+/);
      return needleWords.every(nw => words.some(w => w === nw));
    });

    if (matches.length === 1) {
      const m = matches[0]!;
      if (!seen.has(m.id)) {
        resolved.push({ userId: m.id, fullName: m.full_name });
        seen.add(m.id);
      }
    } else {
      unresolved.push(rawName);
    }
  }

  return { resolved, unresolved };
}

// ─── Reminder config ──────────────────────────────────────────────────────────

async function getDefaultReminderConfig(eventType: string): Promise<ReminderConfig> {
  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(schema.systemSettings.key, 'agenda_reminder_defaults'),
      columns: { value: true },
    });
    if (setting?.value && typeof setting.value === 'object') {
      const settingObj = setting.value as Record<string, ReminderConfig>;
      if (settingObj[eventType]) return settingObj[eventType];
    }
  } catch { /* fallback a hardcoded */ }
  return REMINDER_DEFAULTS[eventType] ?? REMINDER_DEFAULTS.personal;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateInternalSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { messageId } = (await req.json()) as Body;
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });

  // Cargar mensaje y usuario
  const message = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, messageId),
    columns: { id: true, user_id: true, kind: true, text_content: true, cycle_id: true },
  });
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (!message.user_id) return NextResponse.json({ error: 'Message has no user' }, { status: 400 });

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, message.user_id),
    columns: { id: true, phone_e164: true, role: true, full_name: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Resolver texto (texto directo o transcripción de audio)
  let text = message.text_content ?? '';
  if (!text && message.kind === 'audio') {
    const tx = await db.query.transcriptions.findFirst({
      where: eq(schema.transcriptions.inbound_message_id, messageId),
      columns: { text: true },
    });
    text = tx?.text ?? '';
  }
  if (!text) return NextResponse.json({ error: 'No text content to parse' }, { status: 422 });

  // Limpiar eventos pending_confirmation anteriores de este usuario
  // (evita que se acumulen si el usuario escribe varios eventos sin confirmar)
  await db.delete(schema.events).where(
    and(
      eq(schema.events.created_by, user.id),
      eq(schema.events.status, 'pending_confirmation'),
    ),
  );

  // Llamar a la IA
  const dbPrompt = await getActivePrompt('parse-event');
  const systemText = dbPrompt?.system_prompt ?? PARSE_EVENT_SYSTEM;

  const aiResult = await callAI({
    purpose: 'parse_event',
    model: PARSE_EVENT_MODEL,
    systemBlocks: [{ text: systemText, cache: true }],
    userContent: buildParseEventPrompt(text, todayART(), dayOfWeekART()),
    relatedCycleId: message.cycle_id ?? undefined,
    promptId: dbPrompt?.id,
  });

  let parsed: ParseEventOutput;
  try {
    parsed = parseAIJson<ParseEventOutput>(aiResult.text);
  } catch {
    logger.error({ raw: aiResult.text, messageId }, 'parse-event: AI returned invalid JSON');
    await sendWhatsAppText(user.phone_e164, 'Hubo un problema procesando tu mensaje. Intentá de nuevo en un momento.');
    return NextResponse.json({ error: 'AI parse error' }, { status: 500 });
  }

  logger.info(
    { messageId, userId: user.id, confidence: parsed.confidence, type: parsed.type, title: parsed.title },
    'parse-event: AI result',
  );

  // Si la confianza es baja o falta la fecha → pedir aclaración
  if (parsed.confidence < 0.6 || !parsed.starts_at) {
    // Construir un mensaje contextual: si se extrajo un título, úsalo
    const titleHint = parsed.title && parsed.confidence >= 0.4
      ? `Para agendar *${parsed.title}*`
      : 'Para agendar el evento';
    const clarification = `${titleHint}, necesito la fecha y la hora.\n\nEjemplo: "Reunión con EANA el martes 17 a las 10".`;
    const sendResult = await sendWhatsAppText(user.phone_e164, clarification);

    // Guardar en outbound_messages con purpose='event_clarification'.
    // classify-intent lee esto para saber que la próxima respuesta del usuario
    // es una continuación del alta de evento, no un reporte.
    await db.insert(schema.outboundMessages).values({
      provider: sendResult.provider,
      provider_message_id: sendResult.providerMessageId,
      to_phone_e164: user.phone_e164,
      user_id: user.id,
      cycle_id: message.cycle_id ?? null,
      purpose: 'event_clarification',
      body: clarification,
      sent_at: new Date(),
      delivery_status: 'sent',
    });

    await db.update(schema.inboundMessages)
      .set({ processed_at: new Date() })
      .where(eq(schema.inboundMessages.id, messageId));
    return NextResponse.json({ clarificationSent: true, confidence: parsed.confidence });
  }

  // Resolver acompañantes mencionados ("voy con Matías y Juan Pablo")
  const attendeeRes = await resolveMentionedAttendees(parsed.mentioned_attendees ?? [], user.id);

  // Crear el evento con status='pending_confirmation'
  const reminderConfig = await getDefaultReminderConfig(parsed.type);
  const eventId = uuidv7();

  await db.insert(schema.events).values({
    id: eventId,
    title: parsed.title,
    description_md: parsed.description_md ?? null,
    type: parsed.type,
    status: 'pending_confirmation',
    starts_at: new Date(parsed.starts_at),
    ends_at: parsed.ends_at ? new Date(parsed.ends_at) : null,
    all_day: parsed.all_day,
    location: parsed.location ?? null,
    created_by: user.id,
    requires_confirmation: parsed.requires_confirmation,
    is_important: false, // solo executive/press_admin pueden setearlo desde el panel
    reminder_config: reminderConfig,
    source: 'whatsapp',
  });

  // Consumir clarificaciones pendientes: el alta llegó a buen puerto, así que el
  // próximo mensaje del usuario ya no debe enrutarse automáticamente a event_create.
  await db.update(schema.outboundMessages)
    .set({ purpose: 'other' })
    .where(and(
      eq(schema.outboundMessages.user_id, user.id),
      eq(schema.outboundMessages.purpose, 'event_clarification'),
    ));

  // Pre-crear los convocados resueltos. La invitación con botones se envía recién
  // cuando el creador confirma el evento (onEventConfirmed).
  if (attendeeRes.resolved.length > 0) {
    await db.insert(schema.eventAttendees).values(
      attendeeRes.resolved.map(a => ({
        id: uuidv7(),
        event_id: eventId,
        user_id: a.userId,
        status: 'invited' as const,
      })),
    );
  }

  logger.info(
    { eventId, userId: user.id, title: parsed.title, type: parsed.type, attendees: attendeeRes.resolved.length, unresolvedNames: attendeeRes.unresolved },
    'parse-event: event created pending_confirmation',
  );

  // Formatear mensaje de confirmación
  const dateFormatted = formatDateForMessage(parsed.starts_at, parsed.all_day);
  const locationLine = parsed.location ? `📍 ${parsed.location}` : '📍 Sin especificar';
  const typeLine = `🏷 ${TYPE_LABELS[parsed.type] ?? parsed.type}`;

  const attendeesLine = attendeeRes.resolved.length > 0
    ? `\n👥 Con: ${attendeeRes.resolved.map(a => a.fullName).join(', ')} (les aviso al confirmar)`
    : '';
  const unresolvedLine = attendeeRes.unresolved.length > 0
    ? `\n⚠️ No encontré en el Secretariado a: ${attendeeRes.unresolved.join(', ')}. Si querés convocarlos, tocá Editar y nombralos con apellido.`
    : '';

  const warningLine = parsed.missing_fields.length > 0 && !parsed.missing_fields.includes('starts_at')
    ? `\n⚠️ Faltó: ${parsed.missing_fields.join(', ')}`
    : '';

  const confirmBody = `*${parsed.title}*\n📅 ${dateFormatted}\n${locationLine}\n${typeLine}${attendeesLine}${unresolvedLine}${warningLine}`;

  // Enviar mensaje interactivo con botones
  const sendResult = await sendWhatsAppInteractive(
    user.phone_e164,
    confirmBody,
    [
      { id: `confirm_event:${eventId}`, title: '✅ Sí, agendar' },
      { id: `edit_event:${eventId}`,   title: '✏️ Editar' },
      { id: `cancel_event:${eventId}`, title: '❌ Cancelar' },
    ],
    '¿Agendamos esto?',
  );

  // Registrar mensaje saliente
  await db.insert(schema.outboundMessages).values({
    provider: sendResult.provider,
    provider_message_id: sendResult.providerMessageId,
    to_phone_e164: user.phone_e164,
    user_id: user.id,
    cycle_id: message.cycle_id ?? null,
    purpose: 'other',
    body: confirmBody,
    sent_at: new Date(),
    delivery_status: 'sent',
  });

  // Marcar mensaje como procesado
  await db.update(schema.inboundMessages)
    .set({ processed_at: new Date() })
    .where(eq(schema.inboundMessages.id, messageId));

  return NextResponse.json({ eventId, status: 'pending_confirmation', confirmationSent: true });
}
