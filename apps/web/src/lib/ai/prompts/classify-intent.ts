// Prompt para clasificar la intención de un mensaje entrante de un secretario.
// Antes de procesar cualquier mensaje, el sistema determina qué quiso hacer el secretario
// (enviar reporte, avisar que no reporta, pedir licencia, etc.).
// Este clasificador es rápido y económico: usa Haiku y la respuesta es un JSON de dos campos.
export const CLASSIFY_INTENT_SYSTEM = `Sos un clasificador de mensajes para un sistema de reporte semanal y agenda del Secretariado Nacional de ATEPSA, el sindicato argentino de los trabajadores de navegación aérea.

Clasificá el mensaje en una de estas 9 categorías:
- "report": el mensaje habla de actividades, gestiones, reuniones, temas laborales o trabajo realizado en la semana
- "report_followup_reply": el mensaje responde a una pregunta previa del bot sobre un reporte incompleto
- "absence_request": pide vacaciones, licencia o algún tipo de ausencia planificada con fechas
- "weekly_pause": dice que esta semana no va a reportar (ej: "esta semana paso", "no puedo esta semana", "sin novedades")
- "greeting": saludo sin contenido de reporte (ej: "Hola", "Buenas", "Cómo estás", "Buen día", "Hola cómo van", "Todo bien?"). Usá esta categoría cuando el mensaje ES un saludo y NO contiene información sobre actividades laborales de la semana.
- "event_create": el secretario quiere agendar algo — en cualquier forma gramatical y aunque falte la fecha. Formas válidas: imperativas ("agendá reunión con EANA el martes a las 10", "programá una movilización para el viernes"), interrogativas ("¿Podés agendar una reunión?", "¿Me agendás algo para el jueves?", "¿Podés programar una reunión?"), afirmativas ("quiero agendar una reunión", "necesito programar una reunión con EANA", "quiero que me agendes la reunión"). La presencia de palabras como "agendar", "agenda", "reunión", "asamblea", "movilización", "programar", "anotá que" orientan fuertemente a este intent aunque no haya fecha ni detalles — el sistema pedirá los datos faltantes.
- "event_confirmation_reply": está respondiendo en texto a un pedido de confirmación del bot sobre un evento pendiente (ej: "sí", "confirmá", "dale", "no", "cancelalo", "quiero cambiar la hora", "editá el lugar")
- "event_outcome_reply": está respondiendo al bot sobre cómo resultó un evento de la agenda que ya ocurrió (ej: "salió bien", "se canceló a último momento", "fue un éxito, marchamos 200 personas", "no pudo venir mucha gente pero cumplimos los objetivos")
- "unknown": el mensaje no encaja en ninguna categoría anterior, es spam, o está completamente fuera de contexto

Respondé únicamente con JSON válido, sin texto extra antes ni después:
{"intent": "<categoría>", "confidence": <número entre 0.0 y 1.0>}`;

export const CLASSIFY_INTENT_MODEL = 'claude-haiku-4-5-20251001';

export function buildClassifyIntentPrompt(params: {
  messageText: string;
  hasAwaitingFollowup?: boolean;
  hasPendingOutcome?: boolean;
  pendingOutcomeEventTitle?: string;
  quotedBody?: string;
}): string {
  const { messageText, hasAwaitingFollowup, hasPendingOutcome, pendingOutcomeEventTitle, quotedBody } = params;
  const parts: string[] = [];

  if (hasAwaitingFollowup) {
    parts.push('[CONTEXTO: El bot le hizo una pregunta de seguimiento sobre su reporte. Si el mensaje responde a esa pregunta, usá "report_followup_reply". EXCEPCIÓN: si el mensaje claramente quiere agendar algo (menciona "agendar", "reunión", "asamblea", "movilización", "programar" con intención futura), usá "event_create" igualmente — la agenda tiene prioridad sobre el estado de followup del reporte.]');
  }

  if (hasPendingOutcome && pendingOutcomeEventTitle) {
    parts.push(`[CONTEXTO: El bot le preguntó recientemente cómo resultó el evento "${pendingOutcomeEventTitle}". Es probable que este mensaje sea la respuesta a esa pregunta de seguimiento de agenda.]`);
  }

  if (quotedBody) {
    // El secretario está respondiendo citando un mensaje previo del hilo
    parts.push(`[HILO: El secretario está respondiendo a este mensaje: "${quotedBody.slice(0, 300)}"]`);
  }

  const contextBlock = parts.length > 0 ? `\n\n${parts.join('\n')}` : '';
  return `Clasificá este mensaje de un secretario gremial:${contextBlock}\n\nMensaje: "${messageText}"`;
}

export type ClassifyIntentOutput = {
  intent:
    | 'report'
    | 'report_followup_reply'
    | 'absence_request'
    | 'weekly_pause'
    | 'greeting'
    | 'event_create'
    | 'event_confirmation_reply'
    | 'event_outcome_reply'
    | 'unknown';
  confidence: number;
};
