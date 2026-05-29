export const CLASSIFY_INTENT_SYSTEM = `Sos un clasificador de mensajes para un sistema de reporte semanal del Secretariado Nacional de ATEPSA, el sindicato argentino de los trabajadores de navegación aérea.

Clasificá el mensaje en una de estas 5 categorías:
- "report": el mensaje habla de actividades, gestiones, reuniones, temas laborales o trabajo realizado en la semana
- "report_followup_reply": el mensaje responde a una pregunta previa del bot sobre un reporte incompleto
- "absence_request": pide vacaciones, licencia o algún tipo de ausencia planificada con fechas
- "weekly_pause": dice que esta semana no va a reportar (ej: "esta semana paso", "no puedo esta semana", "sin novedades")
- "unknown": el mensaje no encaja en ninguna categoría, es un saludo vacío, o está fuera de contexto

Respondé únicamente con JSON válido, sin texto extra antes ni después:
{"intent": "<categoría>", "confidence": <número entre 0.0 y 1.0>}`;

export const CLASSIFY_INTENT_MODEL = 'claude-haiku-4-5-20251001';

export function buildClassifyIntentPrompt(messageText: string): string {
  return `Clasificá este mensaje de un secretario gremial:\n\n"${messageText}"`;
}

export type ClassifyIntentOutput = {
  intent: 'report' | 'report_followup_reply' | 'absence_request' | 'weekly_pause' | 'unknown';
  confidence: number;
};
