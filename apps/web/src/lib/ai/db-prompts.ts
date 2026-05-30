import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';

export type ActivePrompt = {
  id: string;
  system_prompt: string;
  user_template: string;
};

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
