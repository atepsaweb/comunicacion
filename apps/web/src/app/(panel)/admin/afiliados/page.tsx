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
    dependency: r.dependency,
    position: r.position,
    dni: r.dni,
    legajo: r.legajo,
    email: r.email,
    phone_e164: r.phone_e164,
    notes: r.notes,
    is_active: r.is_active,
  }));

  return <AfiliadosClient initialAffiliates={affiliates} />;
}
