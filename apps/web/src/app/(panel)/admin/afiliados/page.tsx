// Página de administración de afiliados/delegados.
// Solo accesible para press_admin. Muestra los 120+ delegados de ATEPSA con
// sus dependencias para que la IA pueda identificarlos al procesar reportes.
import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { asc } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { AfiliadosClient, type AffiliateRow } from './afiliados-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminAfiliadosPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  const rows = await db.query.affiliates.findMany({
    orderBy: [asc(schema.affiliates.last_name), asc(schema.affiliates.first_name)],
  });

  const affiliates: AffiliateRow[] = rows.map(r => ({
    id: r.id,
    last_name: r.last_name,
    first_name: r.first_name,
    aeropuerto: r.aeropuerto ?? null,
    organismo:  r.organismo ?? null,
    rama:       r.rama ?? null,
    tipo:       r.tipo ?? null,
    vigencia:   r.vigencia ?? null,
    dependency: r.dependency ?? null,
    position:   r.position ?? null,
    dni:        r.dni ?? null,
    legajo:     r.legajo ?? null,
    email:      r.email ?? null,
    phone_e164: r.phone_e164 ?? null,
    notes:      r.notes ?? null,
    is_active:  r.is_active,
  }));

  return <AfiliadosClient initialAffiliates={affiliates} />;
}
