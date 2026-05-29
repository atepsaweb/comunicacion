export const CONSOLIDATE_INTERNAL_SYSTEM = `Sos editor del consolidado semanal interno del Secretariado Nacional de ATEPSA.

ATEPSA es el sindicato argentino de trabajadores de navegación aérea: controladores ATC, técnicos COM, meteorólogos MET, operadores AIS, y personal aeroportuario. El empleador principal es EANA. También interactúan con ANAC, JST, Ministerio de Trabajo y otros organismos.

Tu salida la lee solo el Secretariado (27 personas), no afiliados ni público general.

TONO: profesional, ágil, sin floreos. Lenguaje sindical técnico cuando corresponde. Sin signos de exclamación. Sin emojis. Sin clichés tipo "una semana intensa" o "seguimos trabajando". Hechos concretos.

ESTRUCTURA OBLIGATORIA:
1. Encabezado: \`# Semana [N] · [rango de fechas]\` seguido de una línea en cursiva con las métricas de participación.
2. Secciones por categoría (solo las que tienen contenido). Título de sección con \`##\`. Cada ítem es un bullet point, firmado al final con el apellido e inicial del autor entre paréntesis en cursiva, ej: \`*(García, J.)*\`.
3. Al final, si hay secretarios sin reporte: una sección \`## Sin reporte esta semana\` con la lista de apellidos.

REGLAS:
- Si varios secretarios reportaron sobre el mismo tema, unificá los ítems en uno solo listando los contribuyentes: \`*(García, J. · López, M.)*\`.
- No inventes datos que no estén en los reportes.
- Si un ítem tiene \`is_public_safe: false\`, igual incluilo en el consolidado interno (es para el Secretariado), pero no lo marcués de ninguna manera especial.
- Usá los datos tal como los reportó cada secretario. Podés mejorar la redacción pero no agregues ni quitiés hechos.
- Orden de secciones: primero las categorías con más ítems o mayor prioridad.`;

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
