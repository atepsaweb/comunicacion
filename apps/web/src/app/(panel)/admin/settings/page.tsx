// Página de configuración del sistema.
// Solo accesible para el rol press_admin.
// Permite modificar parámetros operativos del sistema (categorías de reporte,
// máximo de preguntas de seguimiento por ciclo, zona horaria, etc.)
// sin necesidad de editar código.
import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { SettingsClient } from './settings-client';

// Valores por defecto para los parámetros del sistema.
// Si una clave no existe en la base de datos, se inserta con estos valores.
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
  // Máximo de repreguntas por "burst" del usuario. Un burst es una secuencia
  // de mensajes sin un hueco >= 6h. Si pasan más de 6h sin mensajes del usuario,
  // el contador se reinicia y la IA puede volver a hacer hasta este máximo de
  // preguntas sobre los nuevos mensajes.
  { key: 'max_followup_per_burst', value: 2 },
  { key: 'cycle_timezone', value: 'America/Argentina/Buenos_Aires' },
  // Proveedor de WhatsApp activo. 'waha' usa WAHA self-hosted (whatsapp-web.js),
  // 'meta' usa la Cloud API oficial. Cambiar a 'meta' sólo cuando los templates
  // estén aprobados y el webhook esté configurado en Meta Business Manager.
  { key: 'whatsapp_provider', value: 'waha' },
  // Mapa de keys lógicas → templates aprobados en Meta. Las keys las usa el
  // código (otp_login, weekly_kickoff, etc.); los names tienen que coincidir
  // exactamente con los aprobados en Business Manager.
  {
    key: 'whatsapp_meta_templates',
    value: {
      otp_login: { name: 'atepsa_otp_login', language: 'es_AR', body_params: ['code'], auth_otp: true },
      weekly_kickoff: { name: 'atepsa_weekly_kickoff', language: 'es_AR', body_params: ['firstName'] },
      weekly_reminder: { name: 'atepsa_weekly_reminder', language: 'es_AR', body_params: ['firstName'] },
      weekly_delivery: { name: 'atepsa_weekly_delivery', language: 'es_AR', body_params: ['firstName', 'week'] },
      escalation_alert: { name: 'atepsa_escalation_alert', language: 'es_AR', body_params: ['count', 'names'] },
    },
  },
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
