# Módulo Agenda — ATEPSA Reportes

> Estado: **en planificación** (arquitectura cerrada, sin código). Diseñado en sesión de análisis del 2026-06-07.
> Todo el código del sistema base ya está en producción; este módulo se suma encima reutilizando su infraestructura.

## Qué es

Agenda interna del Secretariado Nacional, integrada al sistema de reportes semanales existente. Permite cargar eventos por WhatsApp en lenguaje natural, gestionar confirmaciones de asistencia, enviar recordatorios escalonados, y alimentar automáticamente el reporte semanal con el resultado de los eventos cumplidos.

## Flujo en una línea

WhatsApp (audio/texto) → Claude interpreta el evento → repregunta de confirmación con botones SÍ/NO/EDITAR → se guarda → (si requiere) convocatoria con botones ✅/❌/🤔 → tablero de confirmaciones en el panel → recordatorios escalonados → el día después el bot pregunta "¿cómo salió?" → la respuesta alimenta el reporte semanal.

## Funcionalidades

1. **Carga de eventos por WhatsApp en lenguaje natural** con confirmación previa por botones.
2. **Tres tipos de evento**: `personal` (privado), `secretariat` (visible a los 27, confirmación opcional), `mobilization` (visible a los 27, confirmación obligatoria + tablero).
3. **Confirmación de asistencia por WhatsApp** con botones ✅ Voy / ❌ No puedo / 🤔 Tal vez.
4. **Recordatorios escalonados configurables por evento**: 7d, 24h, 12h, 2h antes + followup el día después. Tope de 4 mensajes por persona por evento.
5. **Permisos de creación**: cualquiera crea eventos personales; `executive` y `press_admin` crean y aprueban eventos institucionales directamente; el resto los *propone* y un miembro de Mesa Ejecutiva aprueba (panel o WhatsApp).
6. **Suscripción a calendarios personales (iCal)**: 3 feeds `.ics` de solo lectura por usuario (completo / secretariado / personal), cada uno con su token revocable. Sin OAuth, sin Google.
7. **Integración con ausencias**: a quien está de licencia no se le convoca ni recuerda; en los tableros figura "en licencia", no "sin responder".
8. **Integración con el reporte semanal**: el followup "¿cómo salió?" se incorpora automáticamente como ítem del reporte del ciclo correspondiente; el trigger del viernes lista los eventos cumplidos de la semana.

## Decisiones de arquitectura tomadas (sesión 2026-06-07)

| # | Decisión |
|---|---|
| 1 | Botones interactivos de WhatsApp **sí**, con dos templates por mensaje: uno con botones y uno de fallback en texto (para ventana de 24h / si Meta no aprobó el interactivo). |
| 2 | Calendario en panel con **librería** (`react-big-calendar` + `date-fns`), no CSS puro. Única dependencia UI nueva del proyecto. |
| 3 | `executive` y `press_admin` crean y aprueban todo directamente. Solo el `secretary` común propone. |
| 4 | Recordatorios en **dos capas**: (a) el creador define qué recordatorios tiene el evento (`reminder_config` en `events`); (b) **cada secretario personaliza/silencia los que recibe** (tabla `agenda_notification_prefs`). Excepción: eventos marcados **Importantes** (`is_important`, solo lo setean `executive`/`press_admin`) **no se pueden silenciar** — se mandan igual ignorando las preferencias del destinatario. |
| 5 | El followup "¿cómo salió?" **se suma automáticamente** al reporte semanal vía el pipeline `extract-report` existente. |
| 6 | iCal: **3 tokens distintos** por usuario (`all` / `secretariat` / `personal`), cada uno revocable por separado. |
| 7 | Eventos **independientes del ciclo**: no hay FK a `weekly_cycles`. El ciclo se calcula en runtime por la fecha del evento (`starts_at` → year + iso_week). Permite agendar hoy un evento de julio. |
| 8 | Aprobación de propuestas por WhatsApp **incluida** desde el arranque, con su propio template de botones Aprobar/Rechazar. |

## Documentos del módulo

- [analisis-proyecto-existente.md](analisis-proyecto-existente.md) — qué se encontró en el código y qué se reutiliza.
- [modelo-de-datos.md](modelo-de-datos.md) — tablas nuevas, enums, modificaciones.
- [workflows-n8n.md](workflows-n8n.md) — workflows nuevos y modificaciones a los existentes.
- [prompts.md](prompts.md) — prompts de Claude con modelo recomendado.
- [endpoints-api.md](endpoints-api.md) — rutas API.
- [componentes-ui.md](componentes-ui.md) — vistas y componentes del panel.
- [plan-implementacion.md](plan-implementacion.md) — fases, orden, dependencias, estimaciones.
- [riesgos.md](riesgos.md) — riesgos técnicos con mitigación.

## Cómo leer esto en una sesión futura con Sonnet

1. Leé el `CLAUDE.md` raíz (te manda acá).
2. Leé este README para el panorama.
3. Leé [plan-implementacion.md](plan-implementacion.md), identificá la fase actual.
4. La fase te referencia los otros docs según lo que toque (schema, workflows, prompts, etc.).
5. Cada fase es autocontenida y deja typecheck + lint en verde antes de cerrar.
