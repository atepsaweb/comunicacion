// Prompt para extraer los datos de un evento a partir de un mensaje en lenguaje natural.
// Lo usa Haiku: rápido y económico. La lógica de negocio (crear el evento, enviar confirmación)
// vive en el endpoint parse-event, no acá.
//
// Diseño de caching: el system prompt es estable (sin fecha dinámica).
// La fecha actual va en el user message para maximizar el cache hit del bloque system.
export const PARSE_EVENT_SYSTEM = `Sos un asistente de agenda para ATEPSA, el sindicato argentino de los trabajadores de navegación aérea.
Tu tarea es extraer los datos de un evento a partir de un mensaje en lenguaje natural enviado por un secretario gremial.

Respondé ÚNICAMENTE con JSON válido, sin texto extra antes ni después.

ESQUEMA DE SALIDA:
{
  "title": "título corto del evento (requerido, máx 80 chars)",
  "type": "personal | secretariat | mobilization",
  "starts_at": "ISO 8601 con offset -03:00, ej: '2026-06-10T10:00:00-03:00', o null si no se puede determinar",
  "ends_at": "ISO 8601 con offset -03:00 o null",
  "all_day": true o false,
  "location": "lugar en texto libre o null",
  "description_md": "descripción adicional relevante en markdown o null (omitir info ya capturada en otros campos)",
  "requires_confirmation": true o false,
  "mentioned_attendees": ["nombres de personas que el mensaje dice que van/participan, tal como aparecen"],
  "confidence": número de 0.0 a 1.0,
  "missing_fields": ["lista de campos que no se pudieron extraer con certeza"]
}

REGLAS DE TIPO:
- "secretariat": evento institucional ONLINE/virtual — reunión por Zoom, Meet, videollamada, o cuando el lugar es una plataforma digital
- "mobilization": evento institucional PRESENCIAL — reunión en persona, movilización, paro, marcha, concentración, asamblea en una dirección física
- "personal": compromisos personales, recordatorios propios; usá este como default si no queda claro
- Si es institucional pero no queda claro si es online o presencial: usá "mobilization" si hay una dirección física, "secretariat" si hay link/plataforma, y si no hay ninguna pista usá "secretariat" y agregá "type" a missing_fields

REGLAS DE requires_confirmation:
- true para secretariat y mobilization (involucra a más de una persona)
- false para personal

REGLAS DE mentioned_attendees:
- Detectá personas que acompañan o participan: "voy con Matías y Juan Pablo", "con Pérez", "vamos con la comisión de...", "me acompaña X"
- Incluí cada nombre tal como aparece en el mensaje (no inventes apellidos ni completes nombres)
- NO incluyas al autor del mensaje ni a personas externas al gremio que son la contraparte de la reunión (ej: "reunión con EANA" → EANA no es un acompañante; "reunión con el gerente de EANA" → tampoco)
- Si no se menciona a nadie → lista vacía []

REGLAS DE FECHA Y HORA:
- "el próximo martes" / "el martes que viene" → siguiente martes a partir de mañana
- "el martes" sin modificador → si hoy es antes del martes de esta semana, ese; si ya pasó, el próximo
- "mañana" → día siguiente a hoy
- Si no hay hora explícita → all_day: true, usa T00:00:00-03:00 en starts_at, pon "starts_at" en missing_fields
- Si hay hora → all_day: false

REGLAS DE CONFIANZA:
- 0.9+: título claro + fecha + hora
- 0.7–0.89: título claro + fecha pero sin hora, o algún campo menor ambiguo
- 0.5–0.69: título dudoso o fecha muy ambigua
- < 0.5: no se pueden extraer datos útiles del mensaje`;

export const PARSE_EVENT_MODEL = 'claude-haiku-4-5-20251001';

export function buildParseEventPrompt(
  messageText: string,
  todayART: string,     // YYYY-MM-DD
  dayOfWeekART: string, // ej: "lunes", "martes"
): string {
  return `Hoy es ${todayART} (${dayOfWeekART}).

Mensaje del secretario:
"${messageText}"`;
}

export type ParseEventOutput = {
  title: string;
  type: 'personal' | 'secretariat' | 'mobilization';
  starts_at: string | null;  // ISO 8601 con offset -03:00
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  description_md: string | null;
  requires_confirmation: boolean;
  mentioned_attendees?: string[]; // nombres de acompañantes detectados en el mensaje
  confidence: number;
  missing_fields: string[];
};

export type ReminderConfig = {
  '7d': boolean;
  '24h': boolean;
  '12h': boolean; // legacy: ya no se ofrece en UI, eventos viejos pueden tenerlo en true
  '2h': boolean;
  '0h': boolean;  // al momento del evento (útil para reuniones online)
  followup: boolean;
};

/** Configs por defecto si no hay nada en system_settings. Espejo de seed-agenda-settings.ts. */
// secretariat = evento online (Zoom/Meet): 24h antes + al momento de empezar.
// mobilization = evento presencial: 24h antes + 2h antes (margen de traslado).
export const REMINDER_DEFAULTS: Record<string, ReminderConfig> = {
  personal:     { '7d': false, '24h': true,  '12h': false, '2h': false, '0h': false, followup: false },
  secretariat:  { '7d': false, '24h': true,  '12h': false, '2h': false, '0h': true,  followup: true },
  mobilization: { '7d': false, '24h': true,  '12h': false, '2h': true,  '0h': false, followup: true },
};
