import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { SettingsClient } from './settings-client';

const DEFAULT_SETTINGS: Array<{ key: string; value: unknown }> = [
  {
    key: 'report_categories',
    value: [
      'Negociación colectiva',
      'Relaciones institucionales',
      'Operacional',
      'Organización interna',
      'Condiciones laborales',
      'Legal',
      'Comunicación',
      'Otro',
    ],
  },
  { key: 'max_followup_per_cycle', value: 2 },
  { key: 'cycle_timezone', value: 'America/Argentina/Buenos_Aires' },
];

export default async function AdminSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  // Seed defaults if they don't exist
  for (const def of DEFAULT_SETTINGS) {
    await db
      .insert(schema.systemSettings)
      .values({ key: def.key, value: def.value as unknown as Record<string, unknown> })
      .onConflictDoNothing();
  }

  const settings = await db.query.systemSettings.findMany({
    columns: { key: true, value: true, updated_at: true },
    orderBy: [schema.systemSettings.key],
  });

  return (
    <SettingsClient
      settings={settings.map(s => ({
        key: s.key,
        value: s.value,
        updatedAt: s.updated_at.toISOString(),
      }))}
    />
  );
}
