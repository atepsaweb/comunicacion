// Función para obtener el prompt activo desde la base de datos.
// Los prompts se editan desde el panel web sin necesidad de cambiar el código.
// Cuando hay un prompt activo en la DB para un slug, lo usa; si no, los endpoints
// usan prompts hardcodeados como fallback.
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';

export type ActivePrompt = {
  id: string;
  system_prompt: string;
  user_template: string;
};

/**
 * Busca el prompt activo para un slug dado.
 * Si no encuentra ninguno (o falla la consulta), retorna null.
 * Los slugs corresponden a las distintas tareas de IA (ej: 'extract-report', 'followup-question').
 */
export async function getActivePrompt(slug: string): Promise<ActivePrompt | null> {
  try {
    const prompt = await db.query.prompts.findFirst({
      where: and(eq(schema.prompts.slug, slug), eq(schema.prompts.is_active, true)),
      columns: { id: true, system_prompt: true, user_template: true },
    });
    return prompt ?? null;
  } catch {
    return null;
  }
}
