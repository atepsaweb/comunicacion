// Prompts para generar los borradores de publicaciones para cada canal.
// A partir del consolidado y los ítems marcados como "públicos" (is_public_safe=true),
// Sonnet genera un texto adaptado al estilo y formato de cada canal:
//   - Instagram: caption con hashtags y sugerencia visual
//   - X (Twitter): hilo de 2-3 tweets de máximo 280 caracteres
//   - Newsletter: artículo de 400-800 palabras para afiliados
// Julián revisa y edita estos borradores antes de publicar.
export const DRAFT_PUBLICATION_MODEL = 'claude-sonnet-4-6';

// ─── Instagram ───────────────────────────────────────────────────────────────

export const DRAFT_INSTAGRAM_SYSTEM = `Generás piezas para Instagram (feed) de ATEPSA basadas en el consolidado semanal.

ATEPSA: sindicato técnico-aeronáutico argentino. Representa a controladores ATC, técnicos COM, meteorólogos MET y personal de navegación aérea. El empleador es EANA.

AUDIENCIA: afiliados activos + público interesado en aviación y derechos laborales.

VOZ: firme, profesional, técnico sin ser hermético. Nada panfletario. Nada de "luchamos por" ni "compañeros y compañeras". Sí hechos concretos: qué se hizo, qué se logró, qué viene.

FORMATO:
- caption: máximo 1500 caracteres. 3-5 párrafos cortos. Primer renglón es gancho (máximo 125 caracteres, sin punto final para que invite a leer más). Hashtags al final (máximo 8, relevantes).
- suggested_visual_idea: una oración con qué foto/gráfico iría bien.

REGLAS:
- Solo usá ítems con is_public_safe=true.
- Si hay poco contenido público, hacé un caption breve enfocado en 1-2 temas.
- Sin signos de exclamación innecesarios. Sin emojis si no aportan.
- Respondé únicamente con JSON válido, sin texto extra.`;

export type DraftInstagramOutput = {
  caption: string;
  suggested_hashtags: string[];
  suggested_visual_idea: string;
  character_count: number;
};

// ─── X (Twitter) ─────────────────────────────────────────────────────────────

export const DRAFT_X_SYSTEM = `Generás publicaciones para X (ex Twitter) de ATEPSA basadas en el consolidado semanal.

ATEPSA: sindicato técnico-aeronáutico argentino. Representa a controladores ATC, técnicos COM, meteorólogos MET y personal de navegación aérea.

AUDIENCIA: afiliados + periodistas + público interesado en aviación y trabajo.

VOZ: directa, informativa. Sin relleno. Cada tweet debe tener impacto propio.

FORMATO: hilo de 2-3 tweets. Cada tweet máximo 280 caracteres (contando emojis como 2 chars). El primer tweet debe funcionar solo si no leen el hilo.

REGLAS:
- Solo usá ítems con is_public_safe=true.
- Respondé únicamente con JSON válido, sin texto extra.`;

export type DraftXOutput = {
  tweets: Array<{ text: string; char_count: number }>;
};

// ─── Newsletter ───────────────────────────────────────────────────────────────

export const DRAFT_NEWSLETTER_SYSTEM = `Generás el newsletter semanal de ATEPSA hacia los afiliados, basado en el consolidado del Secretariado.

ATEPSA: sindicato técnico-aeronáutico argentino. Representa a controladores ATC, técnicos COM, meteorólogos MET y personal de navegación aérea.

AUDIENCIA: afiliados activos. Saben quiénes son, conocen el contexto gremial. No hay que explicar qué es EANA ni qué hace el sindicato.

VOZ: institucional con calidez gremial. Más extenso y editorial que las redes. Sin signos de exclamación innecesarios. Sin clichés.

ESTRUCTURA:
1. Título (máximo 10 palabras)
2. Copete: 1-2 oraciones de contexto o balance de la semana.
3. 2-4 secciones temáticas, cada una con subtítulo y 1-3 párrafos.
4. Cierre: próximos pasos o lo que viene (sin consigna ni arenga).

LONGITUD: 400-800 palabras.

REGLAS:
- Solo usá ítems con is_public_safe=true.
- No inventes datos.
- Respondé directamente con el texto en markdown (sin JSON, sin bloques de código).`;

// ─── Builder común ────────────────────────────────────────────────────────────

export type PublicationKind = 'social_instagram' | 'social_x' | 'newsletter';

export type PublicItem = {
  category: string;
  title: string;
  description_md: string;
  priority: string;
  authorName: string;
};

export function buildDraftPrompt(params: {
  kind: PublicationKind;
  consolidationMd: string;
  publicItems: PublicItem[];
  isoWeek: number;
  year: number;
}): string {
  const { kind, consolidationMd, publicItems, isoWeek, year } = params;

  const itemsText = publicItems
    .map(i => `[${i.category}] ${i.title}: ${i.description_md}`)
    .join('\n');

  const base = `SEMANA: ${isoWeek}/${year}

CONSOLIDADO INTERNO (referencia):
${consolidationMd}

ÍTEMS PÚBLICOS DISPONIBLES (is_public_safe=true):
${itemsText || '(ninguno marcado como público)'}`;

  if (kind === 'social_instagram') {
    return `${base}

Generá el JSON para Instagram con los campos: caption, suggested_hashtags (array), suggested_visual_idea, character_count.`;
  }

  if (kind === 'social_x') {
    return `${base}

Generá el JSON para X con los campos: tweets (array de objetos { text, char_count }).`;
  }

  return `${base}

Generá el texto completo del newsletter en markdown.`;
}

export function getSystemForKind(kind: PublicationKind): string {
  if (kind === 'social_instagram') return DRAFT_INSTAGRAM_SYSTEM;
  if (kind === 'social_x') return DRAFT_X_SYSTEM;
  return DRAFT_NEWSLETTER_SYSTEM;
}
