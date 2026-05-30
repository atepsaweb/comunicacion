import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { UsuariosClient } from './usuarios-client';

export default async function AdminUsuariosPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.role !== 'press_admin') notFound();

  const users = await db.query.users.findMany({
    columns: {
      id: true,
      full_name: true,
      phone_e164: true,
      role: true,
      position: true,
      is_active: true,
      notes: true,
      created_at: true,
      updated_at: true,
    },
    orderBy: [schema.users.full_name],
  });

  const serialized = users.map(u => ({
    ...u,
    created_at: u.created_at.toISOString(),
    updated_at: u.updated_at.toISOString(),
  }));

  return <UsuariosClient users={serialized} />;
}
