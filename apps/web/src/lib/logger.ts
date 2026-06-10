// Configuración del sistema de logs (registros de actividad) de la aplicación.
// Usamos pino, que genera logs en formato JSON estructurado. Esto hace que sea fácil
// buscar y filtrar eventos por cycleId, userId, etc., en producción.
import pino from 'pino';

export const logger = pino({
  // El nivel mínimo de detalle a registrar. En producción usa 'info' salvo que
  // se configure LOG_LEVEL=debug en las variables de entorno.
  level: process.env.LOG_LEVEL ?? 'info',
  // En desarrollo, pino-pretty formatea los logs con colores y texto legible.
  // En producción, se usan logs JSON puros (más eficientes para parsear).
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  }),
});
