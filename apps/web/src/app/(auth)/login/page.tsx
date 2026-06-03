// Pantalla de login del panel. El acceso es por link personal: cada integrante
// del Secretariado tiene un link único que le comparte el Secretario de Prensa.
// Por eso esta página no tiene formulario: solo indica a quién pedirle el link.
export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-700 text-white text-xl font-bold mb-4">
            A
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">ATEPSA</h1>
          <p className="text-sm text-zinc-500 mt-1">Panel del Secretariado Nacional</p>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-900">Acceso por link personal</h2>
          <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
            Para ingresar al panel necesitás un link personal de acceso. Pedíselo a{' '}
            <strong className="text-zinc-900">Julián Gaday</strong> por WhatsApp.
          </p>
          <p className="mt-4 text-xs text-zinc-500">
            Si ya tenés un link y no funciona, puede que haya vencido o haya sido reemplazado.
            En ese caso, pedí uno nuevo.
          </p>
        </div>
      </div>
    </div>
  );
}
