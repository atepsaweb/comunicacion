// Serializador iCal (RFC 5545) sin dependencias externas.
// Genera feeds .ics para suscripción en Google Calendar / Apple Calendar / Outlook.
//
// Limitaciones conocidas y aceptadas:
//   - Usa UTC para todos los timestamps (no TZID local). Los clientes muestran
//     la hora correcta porque convierten UTC a la zona local del usuario.
//   - No implementa VTIMEZONE (innecesario cuando se usa UTC).
//   - La longitud máxima de línea (75 octetos) se respeta mediante fold.

const PRODID = '-//ATEPSA//Agenda Secretariado//ES';
const CRLF = '\r\n';

// ─── Helpers RFC 5545 ─────────────────────────────────────────────────────────

/** Dobla líneas largas (> 75 octetos) con CRLF + espacio. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  chunks.push(line.slice(0, 75));
  let pos = 75;
  while (pos < line.length) {
    chunks.push(' ' + line.slice(pos, pos + 74));
    pos += 74;
  }
  return chunks.join(CRLF);
}

/** Escapa caracteres reservados en valores de texto (RFC 5545 §3.3.11). */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Formatea Date como YYYYMMDDTHHMMSSZ (UTC). */
function toUtcDateTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Formatea Date como YYYYMMDD (para eventos de todo el día). */
function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

export interface IcalEvent {
  uid: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  dtstart: Date;
  dtend?: Date | null;
  allDay: boolean;
  status: 'confirmed' | 'cancelled' | 'done' | 'proposed';
  lastModified: Date;
  dtstamp: Date;
}

// ─── Serialización ────────────────────────────────────────────────────────────

function serializeEvent(ev: IcalEvent): string {
  const lines: string[] = ['BEGIN:VEVENT'];

  lines.push(`UID:${ev.uid}@atepsa`);
  lines.push(`DTSTAMP:${toUtcDateTime(ev.dtstamp)}`);
  lines.push(`LAST-MODIFIED:${toUtcDateTime(ev.lastModified)}`);

  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toDateOnly(ev.dtstart)}`);
    // DTEND para todo el día = día siguiente (convención RFC 5545)
    const dtend = ev.dtend ?? new Date(ev.dtstart.getTime() + 86400000);
    lines.push(`DTEND;VALUE=DATE:${toDateOnly(dtend)}`);
  } else {
    lines.push(`DTSTART:${toUtcDateTime(ev.dtstart)}`);
    if (ev.dtend) {
      lines.push(`DTEND:${toUtcDateTime(ev.dtend)}`);
    }
  }

  lines.push(fold(`SUMMARY:${escapeText(ev.summary)}`));

  if (ev.description) {
    lines.push(fold(`DESCRIPTION:${escapeText(ev.description)}`));
  }
  if (ev.location) {
    lines.push(fold(`LOCATION:${escapeText(ev.location)}`));
  }

  // STATUS según RFC 5545
  const statusMap: Record<string, string> = {
    confirmed: 'CONFIRMED',
    proposed:  'TENTATIVE',
    done:      'CONFIRMED',
    cancelled: 'CANCELLED',
  };
  lines.push(`STATUS:${statusMap[ev.status] ?? 'CONFIRMED'}`);

  lines.push('END:VEVENT');
  return lines.join(CRLF);
}

export function buildIcalFeed(calName: string, events: IcalEvent[]): string {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escapeText(calName)}`),
    'X-WR-TIMEZONE:America/Argentina/Buenos_Aires',
  ].join(CRLF);

  const body = events.map(serializeEvent).join(CRLF);
  const footer = 'END:VCALENDAR';

  return [header, body, footer].filter(Boolean).join(CRLF) + CRLF;
}
