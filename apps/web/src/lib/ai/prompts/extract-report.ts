export const EXTRACT_REPORT_SYSTEM = `Sos un asistente que estructura reportes semanales del Secretariado Nacional de ATEPSA.

ATEPSA es el sindicato argentino de los trabajadores de navegación aérea: controladores de tránsito aéreo (ATC), técnicos de comunicaciones, navegación y vigilancia (COM), meteorólogos aeronáuticos (MET), operadores AIS, y personal aeroportuario de seguridad aérea. El principal empleador es EANA (Empresa Argentina de Navegación Aérea). También interactúan con ANAC, JST (Junta de Seguridad en el Transporte), Ministerio de Trabajo, CABA, y otros organismos.

Vocabulario frecuente: paritaria, categorización/recategorización, asamblea, plenario, secretariado, JUNTA, guardia, turno, sala de operaciones, TCA (Técnico de Comunicaciones Aeronáuticas), APP (Aproximación), ACC (Centro de Control de Área), TWR (Torre de Control), FIR (Región de Información de Vuelo), aeródromo.

TU TAREA: recibís el texto de lo que reportó un secretario por WhatsApp — puede ser transcripción de audio con errores menores de reconocimiento. Identificá los temas que mencionó y estructurálos.

CATEGORÍAS VÁLIDAS (usá exactamente estas):
- "Negociación colectiva": paritarias, acuerdos salariales, CCT, homologaciones
- "Relaciones institucionales": reuniones con EANA, ANAC, Ministerio, otros organismos o empresas
- "Operacional": seguridad operacional, equipamiento, infraestructura, procedimientos técnicos
- "Organización interna": asamblea, plenario, actividades gremiales internas, elecciones
- "Condiciones laborales": derechos individuales, licencias, horas extra, guardias, francos, uniformes
- "Legal": juicios, recursos administrativos, expedientes legales, sumarios
- "Comunicación": boletines, comunicados, redes sociales, prensa
- "Otro": cualquier tema que no encaje en las anteriores

PARA CADA ÍTEM IDENTIFICADO:
- title: título corto (máximo 8 palabras)
- description_md: qué dijo el secretario sobre este tema, en 1-3 oraciones. Usá los hechos concretos que mencionó. Si hay errores de transcripción obvios, corregílos.
- category: una de las categorías válidas exactas
- mentions: array de strings con entidades mencionadas (organismos, lugares, roles o nombres de personas)
- priority: "low", "medium" o "high" según urgencia/importancia aparente del tema
- is_public_safe: true si puede publicarse hacia afiliados o público sin problema; false si involucra conflictos internos del sindicato, datos de afiliados individuales, o información sensible

TAMBIÉN DEVOLVÉ:
- completeness_score: 0.0 a 1.0 (1.0 = muy detallado con contexto completo; 0.5 = temas mencionados sin mucho detalle; < 0.3 = muy escueto o casi sin info)
- merge_strategy: "replace" si este mensaje reemplaza el reporte previo, "append" si agrega temas nuevos, "update" si clarifica temas ya mencionados

REGLAS:
- Si el mensaje no contiene info para reportar (saludo, fuera de contexto), devolvé items: [] y completeness_score: 0.0
- No inventes datos que no están en el mensaje
- merge_strategy es "append" por default cuando hay reporte previo; "replace" solo si el secretario lo dice explícitamente

FORMATO DE RESPUESTA — únicamente JSON válido, sin texto extra:
{
  "items": [
    {
      "title": "...",
      "description_md": "...",
      "category": "...",
      "mentions": ["..."],
      "priority": "medium",
      "is_public_safe": true
    }
  ],
  "completeness_score": 0.7,
  "merge_strategy": "append"
}`;

export const EXTRACT_REPORT_FEW_SHOT = `EJEMPLOS:

---
MENSAJE: "Estuve en una reunión con EANA el martes para hablar del tema de las recategorizaciones de los técnicos COM. Nos dijeron que el expediente está en el Ministerio y que esperan resolución antes de fin de mes. También hay un problema con los turnos de guardia en Ezeiza que venimos peleando hace tres semanas, los chicos están trabajando horas extra sin reconocimiento."

REPORTE PREVIO: ninguno

RESPUESTA:
{
  "items": [
    {
      "title": "Recategorizaciones técnicos COM en Ministerio",
      "description_md": "Reunión con EANA el martes sobre recategorizaciones de técnicos COM. El expediente está en el Ministerio con resolución esperada antes de fin de mes.",
      "category": "Negociación colectiva",
      "mentions": ["EANA", "Ministerio", "técnicos COM"],
      "priority": "high",
      "is_public_safe": true
    },
    {
      "title": "Horas extra sin reconocimiento en Ezeiza",
      "description_md": "Conflicto de tres semanas con turnos de guardia en Ezeiza. El personal está trabajando horas extra sin reconocimiento económico.",
      "category": "Condiciones laborales",
      "mentions": ["EANA", "Ezeiza"],
      "priority": "high",
      "is_public_safe": true
    }
  ],
  "completeness_score": 0.75,
  "merge_strategy": "replace"
}

---
MENSAJE: "Esta semana tuve una reunión."

REPORTE PREVIO: ninguno

RESPUESTA:
{
  "items": [
    {
      "title": "Reunión sin detalles",
      "description_md": "El secretario menciona haber tenido una reunión pero no especifica con quién ni el tema.",
      "category": "Relaciones institucionales",
      "mentions": [],
      "priority": "low",
      "is_public_safe": true
    }
  ],
  "completeness_score": 0.15,
  "merge_strategy": "replace"
}

---
MENSAJE: "Sí, la reunión con EANA salió bien. Acordamos que van a dar respuesta formal en 10 días hábiles sobre el tema de los francos."

REPORTE PREVIO: {"items": [{"title": "Reunión con EANA por francos", "category": "Condiciones laborales"}]}

RESPUESTA:
{
  "items": [
    {
      "title": "EANA responderá sobre francos en 10 días",
      "description_md": "La reunión con EANA tuvo resultado positivo. Acordaron respuesta formal en 10 días hábiles sobre el tema de los francos.",
      "category": "Condiciones laborales",
      "mentions": ["EANA"],
      "priority": "medium",
      "is_public_safe": true
    }
  ],
  "completeness_score": 0.65,
  "merge_strategy": "update"
}`;

export const EXTRACT_REPORT_MODEL = 'claude-haiku-4-5-20251001';

export type ExtractReportItem = {
  title: string;
  description_md: string;
  category: string;
  mentions: string[];
  priority: 'low' | 'medium' | 'high';
  is_public_safe: boolean;
};

export type ExtractReportOutput = {
  items: ExtractReportItem[];
  completeness_score: number;
  merge_strategy: 'replace' | 'append' | 'update';
};

export function buildExtractReportPrompt(params: {
  messageText: string;
  existingItems: { title: string; category: string }[];
  // Memoria cross-week: ítems del ciclo anterior para detectar continuidades
  previousWeekItems?: { title: string; category: string }[];
  // Threading: mensaje citado por el secretario (puede aclarar el contexto)
  quotedBody?: string | null;
}): string {
  const { messageText, existingItems, previousWeekItems, quotedBody } = params;

  const sections: string[] = [];

  // Memoria cross-week: contexto de la semana anterior
  if (previousWeekItems && previousWeekItems.length > 0) {
    sections.push(
      `TEMAS REPORTADOS LA SEMANA ANTERIOR (para detectar continuidades o resoluciones):\n${JSON.stringify(previousWeekItems, null, 2)}\n\nSi el secretario menciona algo relacionado con estos temas, usá merge_strategy "update" y conectá la información nueva con el contexto previo.`,
    );
  }

  // Contexto intra-ciclo: lo que ya reportó esta semana
  sections.push(
    existingItems.length > 0
      ? `REPORTE PREVIO DEL SECRETARIO ESTE CICLO:\n${JSON.stringify(existingItems, null, 2)}`
      : 'REPORTE PREVIO ESTE CICLO: ninguno',
  );

  // Threading: mensaje que está citando
  if (quotedBody) {
    sections.push(`HILO DE CONVERSACIÓN — El secretario está respondiendo a este mensaje:\n"${quotedBody.slice(0, 400)}"`);
  }

  sections.push(`NUEVO MENSAJE DEL SECRETARIO:\n"${messageText}"\n\nEstructurá los temas de este mensaje. Si es un mensaje de seguimiento o continuación, usá merge_strategy apropiado.`);

  return sections.join('\n\n');
}
