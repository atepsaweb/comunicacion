import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const roleLabels: Record<string, string> = {
  secretary: 'Secretario/a',
  executive: 'Mesa Ejecutiva',
  press_admin: 'Prensa',
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? 'secretary';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">
          Bienvenido/a, {session?.user.full_name}
        </h1>
        <p className="text-zinc-500 mt-1">{roleLabels[role]} — Secretariado Nacional</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reportes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">—</p>
            <p className="text-sm text-zinc-500 mt-1">Disponible en Fase 3</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ciclo actual</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">—</p>
            <p className="text-sm text-zinc-500 mt-1">Disponible en Fase 6</p>
          </CardContent>
        </Card>

        {role === 'press_admin' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publicaciones pendientes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-zinc-900">—</p>
              <p className="text-sm text-zinc-500 mt-1">Disponible en Fase 7</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <p className="text-zinc-400 text-sm">
            El sistema está en construcción. Las funcionalidades se irán habilitando en cada fase.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
