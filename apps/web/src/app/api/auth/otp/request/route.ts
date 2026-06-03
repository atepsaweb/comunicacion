// Endpoint deprecado: el login por OTP fue reemplazado por links personales
// generados por el admin desde /admin/usuarios. Se mantiene el path para que
// cualquier cliente viejo reciba una respuesta explícita en lugar de un 404.
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: 'El acceso por OTP fue reemplazado por links personales. Pedile el link a Julián Gaday.',
    },
    { status: 410 },
  );
}
