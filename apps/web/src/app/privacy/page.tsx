// Política de privacidad pública. Cumple el requisito de Meta para publicar
// la app de WhatsApp Business y queda disponible para cualquier integrante
// del Secretariado que la quiera consultar.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de privacidad — ATEPSA',
  description: 'Política de privacidad del sistema interno de reporte del Secretariado Nacional de ATEPSA.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800">
      <h1 className="text-3xl font-bold tracking-tight">Política de privacidad</h1>
      <p className="mt-2 text-sm text-slate-500">Última actualización: 3 de junio de 2026</p>

      <section className="mt-8 space-y-4 text-[15px] leading-relaxed">
        <p>
          Esta política describe cómo la Asociación Técnicos y Empleados de Protección y Seguridad
          a la Aeronavegación (<strong>ATEPSA</strong>) trata la información en el sistema interno
          de reporte semanal del Secretariado Nacional, accesible en{' '}
          <a href="https://panel.atepsa.org.ar" className="text-blue-700 underline">
            panel.atepsa.org.ar
          </a>.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Alcance</h2>
        <p>
          El sistema es de uso exclusivamente interno del Secretariado Nacional de ATEPSA y del
          personal autorizado por la Secretaría de Prensa. No está abierto al público general ni
          a personas afiliadas que no integren el Secretariado.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Responsable del tratamiento</h2>
        <p>
          ATEPSA, con domicilio en Ciudad Autónoma de Buenos Aires, República Argentina. Consultas
          sobre esta política o sobre los datos tratados se canalizan vía la Secretaría de Prensa:{' '}
          <a href="mailto:prensa@atepsa.org.ar" className="text-blue-700 underline">
            prensa@atepsa.org.ar
          </a>.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Datos que tratamos</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Nombre y apellido de cada integrante del Secretariado.</li>
          <li>Número de teléfono en formato internacional (para identificar mensajes entrantes y enviar comunicaciones).</li>
          <li>Rol y cargo dentro del Secretariado.</li>
          <li>Mensajes enviados por WhatsApp al número institucional del sistema: texto, audios y archivos que el integrante decide compartir.</li>
          <li>Transcripciones de los audios y extracciones de texto de los documentos enviados.</li>
          <li>Ausencias y pausas semanales declaradas.</li>
          <li>Registros técnicos de actividad (logs) con fines de auditoría.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Finalidades</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Recibir, procesar y consolidar los reportes semanales de actividad gremial.</li>
          <li>Generar piezas de comunicación interna y externa a partir de esos reportes, sujetas siempre a revisión humana antes de su difusión.</li>
          <li>Coordinar el trabajo del Secretariado y dar seguimiento a temas pendientes.</li>
          <li>Identificar al usuario al iniciar sesión en el panel mediante un código de un solo uso enviado por WhatsApp.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Base de licitud</h2>
        <p>
          El tratamiento se realiza con el consentimiento de cada integrante del Secretariado, en
          el marco de sus funciones dentro de la organización gremial.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Cómo se almacenan los datos</h2>
        <p>
          Toda la información se aloja en un servidor propio de ATEPSA bajo control directo del
          gremio. No se utilizan servicios cloud de terceros para guardar mensajes ni datos
          personales. La única conexión saliente del sistema es hacia la API de Anthropic (Claude)
          para tareas de procesamiento de lenguaje natural sobre los textos transcritos; estos
          envíos no incluyen datos identificatorios más allá del contenido textual necesario para
          la tarea.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Comunicación por WhatsApp</h2>
        <p>
          El sistema utiliza WhatsApp Business Platform para enviar y recibir mensajes con
          integrantes del Secretariado. WhatsApp y Meta procesan los mensajes en su carácter de
          proveedor del canal de comunicación, sujetos a sus propias políticas. Los mensajes que
          provienen de números no registrados en el sistema se descartan automáticamente.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Acceso a los datos</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Cada integrante puede ver sus propios reportes, ausencias y mensajes.</li>
          <li>La Mesa Ejecutiva puede consultar datos de cumplimiento y estadísticas agregadas del Secretariado.</li>
          <li>La Secretaría de Prensa tiene acceso integral para administrar el sistema, revisar los reportes consolidados y publicar las piezas de comunicación.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Plazos de retención</h2>
        <p>
          Los datos se conservan mientras la persona integre el Secretariado y por hasta dos años
          adicionales con fines de archivo histórico de la actividad gremial. Las copias de
          respaldo se rotan con un período máximo de treinta días.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Derechos</h2>
        <p>
          Cada integrante del Secretariado puede solicitar acceso, rectificación o supresión de
          sus datos personales escribiendo a la Secretaría de Prensa. Los reportes ya consolidados
          y firmados quedan archivados como parte del registro histórico del Secretariado.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Cambios en esta política</h2>
        <p>
          Las modificaciones se reflejan en esta misma página, con actualización de la fecha al
          inicio del documento.
        </p>
      </section>
    </main>
  );
}
