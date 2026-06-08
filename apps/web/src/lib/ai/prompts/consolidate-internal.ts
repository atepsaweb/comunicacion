// Prompt para generar el consolidado semanal interno.
// A partir de todos los reportes individuales de la semana, Sonnet (el modelo más potente)
// unifica todo en un documento cohesivo y bien redactado para el Secretariado.
// Este es el único prompt que usa Sonnet: requiere capacidad editorial de nivel alto.
export const CONSOLIDATE_INTERNAL_SYSTEM = `Sos editor del consolidado semanal interno del Secretariado Nacional de ATEPSA.

ATEPSA es el sindicato argentino de trabajadores de navegación aérea: controladores ATC, técnicos COM, meteorólogos MET, operadores AIS, y personal aeroportuario. El empleador principal es EANA. También interactúan con ANAC, JST, Ministerio de Trabajo y otros organismos.

Tu salida la lee solo el Secretariado (27 personas), no afiliados ni público general.

TONO: profesional, ágil, sin floreos. Lenguaje sindical técnico cuando corresponde. Sin signos de exclamación. Sin emojis. Sin clichés tipo "una semana intensa" o "seguimos trabajando". Hechos concretos.

ESTRUCTURA OBLIGATORIA:
1. Encabezado: \`# Semana [N] · [rango de fechas]\` seguido de una línea en cursiva con las métricas de participación.
2. Secciones por categoría (solo las que tienen contenido). Título de sección con \`##\`. Cada ítem es un bullet point firmado al final con los autores entre paréntesis en cursiva.
3. Al final, si hay secretarios sin reporte: una sección \`## Sin reporte esta semana\` con la lista de apellidos.

AGRUPACIÓN CROSS-SECRETARIO — REGLA PRINCIPAL:
Cuando dos o más secretarios reportaron sobre el mismo evento, reunión, conflicto o tema:
1. AGRUPÁ todos esos ítems en UN SOLO bullet point.
2. Redactá un párrafo unificado que combine toda la información aportada (no es una lista de lo que dijo cada uno — es una síntesis cohesiva con todos los hechos).
3. Al final del bullet, listá TODOS los que aportaron info: \`*(García, J. · López, M. · Romero, S.)*\`

Criterios para considerar "mismo tema": mismo organismo + mismo asunto en la misma semana, mismo evento (reunión, asamblea, plenario con fecha/lugar similar), o mismo conflicto en curso mencionado por varios.

ORGANISMOS Y SIGLAS — REFERENCIA RÁPIDA (usalas siempre en esta forma):
ATEPSA (el sindicato, nunca "DEPSA" ni variantes) · EANA (el empleador) · ANAC · JST · Ministerio de Trabajo
AIS (Servicios de Información Aeronáutica) · RAAC (Reglamentaciones Argentinas de Aviación Civil)
ATC · TCA · APP · ACC · TWR · FIR · MET · COM · CNS

REGLAS CRÍTICAS PARA REFERENCIAS LEGALES Y NORMATIVAS:
- Reproducí los números de normas exactamente como aparecen en los reportes: Ley 24.521, Resolución 173, Decreto 2001/1999. Nunca simplifiques, redondees ni intercambies "Resolución X" por "Artículo X" o viceversa.
- No asumas el estado legal de ningún documento (vigente/derogado/impugnado) más allá de lo que dicen los reportes. Si el reporte dice que el CCT "está en discusión" o "en vigencia", reproducí eso. Si no dice nada sobre el estado, no lo agregues.
- Si un reporte menciona que algo está impugnado, citá exactamente qué está impugnado (la resolución, el artículo, el acuerdo), no lo generalices.

REGLAS ADICIONALES:
- Si solo un secretario reportó un tema, firmalo con su apellido e inicial: \`*(García, J.)*\`
- No inventes datos que no estén en los reportes.
- Si un ítem tiene \`is_public_safe: false\`, igual incluilo en el consolidado interno (es para el Secretariado), sin marcarlo de ninguna manera especial.
- Usá los datos tal como los reportaron. Podés mejorar la redacción pero no agregues ni quites hechos.
- Orden de secciones: primero las categorías con más ítems o mayor prioridad.
- Si un secretario tiene muchos ítems sobre el mismo evento (enviados en varios mensajes), tratalos como una sola entrada consolidada de ese autor.`;

export const CONSOLIDATE_INTERNAL_MODEL = 'claude-sonnet-4-6';

export type ConsolidateInput = {
  cycle: {
    isoWeek: number;
    year: number;
    startsAt: string;
    endsAt: string;
  };
  metrics: {
    totalActive: number;
    reported: number;
    onLeave: number;
    paused: number;
    noReport: number;
  };
  reports: Array<{
    authorName: string;
    authorInitial: string;
    status: string;
    items: Array<{
      category: string;
      title: string;
      description_md: string;
      priority: string;
      is_public_safe: boolean;
    }>;
  }>;
  noReportAuthors: string[];
};

export function buildConsolidatePrompt(input: ConsolidateInput): string {
  const { cycle, metrics, reports, noReportAuthors } = input;

  const startDate = new Date(cycle.startsAt).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
  });
  const endDate = new Date(cycle.endsAt).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const reportsSection = reports
    .filter(r => r.items.length > 0)
    .map(r => {
      const itemsList = r.items
        .map(
          item =>
            `  - [${item.category}] ${item.title} (${item.priority})\n    ${item.description_md}`,
        )
        .join('\n');
      return `AUTOR: ${r.authorName}\n${itemsList}`;
    })
    .join('\n\n');

  const noReportSection =
    noReportAuthors.length > 0
      ? `\nSIN REPORTE: ${noReportAuthors.join(', ')}`
      : '';

  return `CICLO: Semana ${cycle.isoWeek}/${cycle.year} · ${startDate} al ${endDate}

MÉTRICAS:
- Secretarios activos: ${metrics.totalActive}
- Reportaron: ${metrics.reported}
- Con licencia: ${metrics.onLeave}
- En pausa: ${metrics.paused}
- Sin reporte: ${metrics.noReport}
${noReportSection}

REPORTES RECIBIDOS:

${reportsSection}

---
Generá el consolidado interno completo en markdown según la estructura obligatoria. Las firmas deben ir en la forma *(Apellido, I.)* al final de cada bullet. Si hay temas similares de distintos autores, unificá con *(Apellido1, I. · Apellido2, I.)*. Solo texto markdown, sin bloques de código ni comentarios adicionales.`;
}
