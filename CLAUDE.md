# CLAUDE.md — Contexto para sesiones con Claude Code

Este archivo es el primer lugar que tenés que leer al arrancar una sesión en este repo. Acá está lo que NO se ve a primera vista en el código.

---

## Qué es ATEPSA

**ATEPSA** (Asociación Técnicos y Empleados de Protección y Seguridad a la Aeronavegación) es el gremio argentino que representa a los trabajadores de los servicios de navegación aérea: controladores de tránsito aéreo, técnicos de comunicaciones, navegación y vigilancia, meteorólogos aeronáuticos, AIS, despachantes operativos y personal aeroportuario relacionado con la seguridad de la aviación.

Es un sindicato técnico, con afiliados altamente especializados, y una historia larga de conflictos por condiciones laborales y seguridad operacional. Trabaja principalmente sobre EANA (Empresa Argentina de Navegación Aérea) y otros organismos del sistema aeronáutico.

**Identidad comunicacional**: voz firme, técnica, no panfletaria. Tono institucional con calidez gremial. Nada de signos de exclamación gritados, nada de mayúsculas innecesarias, nada de lenguaje agresivo. Lenguaje preciso, profesional, con orgullo del oficio.

---

## Qué es este proyecto

Sistema interno de reporte semanal con asistencia de IA para el **Secretariado Nacional** (27 personas: secretarios, vocales y comisión revisora de cuentas).

**Problema que resuelve**: hoy cada secretario trabaja en paralelo y no hay forma sistemática de saber qué se hizo en la semana, ni de comunicarlo afuera.

**Flujo en una línea**: WhatsApp (audio/texto) → transcripción → extracción IA → repreguntas → consolidación → tres outputs (resumen interno, redes, newsletter) → revisión humana del Sec. de Prensa → publicación.

El detalle completo del flujo está en [`docs/workflows.md`](docs/workflows.md).

---

## Quién es el usuario principal

**Julián Gaday** — Secretario de Prensa de ATEPSA. Es:
- El sponsor del proyecto.
- El admin del sistema (rol Nivel 3).
- El único que revisa y publica los outputs.
- El que va a iterar este código en sesiones futuras con vos.

Los otros 27 secretarios son usuarios finales: reportan por WhatsApp y consultan el panel ocasionalmente.

---

## Decisiones tomadas (NO discutir de nuevo, salvo que él lo pida)

Todas estas se decidieron en la sesión inicial. El detalle está en [`docs/decisiones.md`](docs/decisiones.md).

1. **VPS propio de ATEPSA** con acceso root, 8GB+ RAM, 4+ cores. Todo corre ahí.
2. **Soberanía de datos**: nada sale del VPS salvo llamadas a Claude API.
3. **WhatsApp**: arrancamos con **Evolution API** self-hosted (Docker). Migración a **Meta Cloud API oficial** está planificada para una fase posterior.
4. **Orquestación**: **n8n self-hosted** (Docker).
5. **DB**: **PostgreSQL 16** local.
6. **Transcripción**: **faster-whisper** local en CPU, modelo `medium` en español.
7. **IA**: **Claude API**. Haiku 4.5 para extracción/clasificación, Sonnet 4.6 para redacción final. Detalle en [`docs/prompts-strategy.md`](docs/prompts-strategy.md).
8. **Panel web**: Next.js 14 (App Router) + shadcn/ui + Tailwind + Drizzle + Auth.js.
9. **Login**: **OTP por WhatsApp** (reutiliza el bot, cero passwords).
10. **Onboarding**: pre-carga manual de los 27 desde el panel; identificación automática por número de WhatsApp; mensajes de números no registrados se descartan.
11. **Outputs**: el sistema entrega texto e imágenes listas en el panel; Julián copia y pega manualmente a cada canal (IG, FB, X, web, mail). **Cero integraciones automáticas con redes sociales o SMTP** en esta etapa.
12. **Repo**: **GitHub privado**.
13. **Reportes consolidados internos**: van **firmados por autor**. Transparencia interna total dentro del Secretariado.
14. **La IA nunca publica sola**: siempre revisión humana de Julián antes de publicar.

---

## Convenciones de código

- **TypeScript estricto**. `noImplicitAny: true`, `strict: true`. Prohibido `any` salvo justificación en comentario inline.
- **Idioma**: documentación y commits en español; código (identificadores, comentarios técnicos) en inglés.
- **Naming**: `camelCase` para variables y funciones, `PascalCase` para tipos y componentes React, `SCREAMING_SNAKE_CASE` para constantes y env vars.
- **Drizzle**: tablas en snake_case (`weekly_cycles`), tipos exportados en PascalCase (`WeeklyCycle`).
- **Comentarios**: mínimos. Solo cuando el "por qué" no es obvio. Nunca documentar "qué" hace una función bien nombrada.
- **Error handling**: errores de boundary (API externa, DB, filesystem) se capturan y loguean. Errores internos no se atrapan: dejá que el server crashee y reinicie.
- **Logs**: estructurados, JSON, con `userId`, `cycleId`, `workflow`, `step` cuando aplique. Usar `pino` en Next.js.
- **Secrets**: nunca commit. Todo en `.env.local` (dev) y `/opt/atepsa-reportes/.env` (prod). `.env.example` con keys vacías está versionado.
- **Commits**: presente imperativo en español. `agrega validación de OTP`, `corrige timeout en transcriber`, `refactoriza schema de absences`.

---

## Qué NO hacer

- ❌ No agregar dependencias externas sin discutirlo (cada lib es una superficie de ataque y mantenimiento).
- ❌ No usar servicios cloud de terceros (Vercel, Supabase, Auth0, SendGrid, etc.) sin permiso explícito. Soberanía es regla.
- ❌ No exponer endpoints `/api/internal/*` sin auth por shared secret (los consume n8n).
- ❌ No publicar nada en redes/mail automáticamente. Todo pasa por la bandeja de revisión.
- ❌ No incluir nombres reales de afiliados o conflictos sensibles en el repo (tests, fixtures, ejemplos): usá nombres genéricos tipo "Pérez, J.".
- ❌ No tocar el VPS sin avisar a Julián. Cambios en infra van por PR.
- ❌ No crear documentación nueva en `docs/` sin pedirlo. Editar la existente sí.

---

## Cómo trabajar en este repo

### Cuando arranques una sesión nueva

1. Leé este archivo entero.
2. Mirá [`docs/plan-implementacion.md`](docs/plan-implementacion.md) para saber en qué fase estamos.
3. Si la tarea es del **módulo Agenda** (eventos, convocatorias, recordatorios, iCal), leé [`docs/modulo-agenda/README.md`](docs/modulo-agenda/README.md) y su [`plan-implementacion.md`](docs/modulo-agenda/plan-implementacion.md). Es un módulo nuevo en planificación (arquitectura cerrada el 2026-06-07, sin código todavía).
4. Mirá los últimos commits (`git log --oneline -20`) para entender el estado actual.
5. Preguntale a Julián qué tarea quiere atacar.

### Cuando estés trabajando

- Usá TodoWrite para tareas no triviales.
- Hacé commits chicos y atómicos.
- Si descubrís que una decisión del proyecto está mal o necesita revisión, **decímelo antes de cambiarla**. No actúes unilateralmente sobre las decisiones de [`docs/decisiones.md`](docs/decisiones.md).
- Si necesitás agregar una tabla nueva al schema, actualizá [`docs/modelo-de-datos.md`](docs/modelo-de-datos.md) en el mismo PR.
- Si necesitás agregar un workflow de n8n, exportalo a `n8n/workflows/<nombre>.json` y describilo en [`docs/workflows.md`](docs/workflows.md).

### Cuando termines una tarea

- Verificá que el typecheck pasa (`pnpm typecheck`).
- Verificá que los linters pasan (`pnpm lint`).
- Si hay tests, corrélos.
- Actualizá [`docs/plan-implementacion.md`](docs/plan-implementacion.md) marcando lo completado.

---

## Estilo de comunicación con Julián

- Español rioplatense, tuteándolo.
- Directo, sin rodeos. Sin "voy a ser claro" o "permitime explicarte".
- Si algo no te cierra, decilo.
- Si te falta info, preguntá antes de asumir.
- Para confirmar decisiones, ofrecé opciones concretas, no abiertas.
- Brevedad sobre verbosidad. Una oración clara > un párrafo redundante.

---

## Links rápidos

- [README.md](README.md) — visión ejecutiva.
- [docs/arquitectura.md](docs/arquitectura.md) — componentes y diagramas.
- [docs/modelo-de-datos.md](docs/modelo-de-datos.md) — schema conceptual.
- [docs/workflows.md](docs/workflows.md) — flujos de n8n.
- [docs/prompts-strategy.md](docs/prompts-strategy.md) — modelos de Claude por tarea.
- [docs/plan-implementacion.md](docs/plan-implementacion.md) — fases y orden.
- [docs/riesgos.md](docs/riesgos.md) — riesgos y mitigaciones.
- [docs/decisiones.md](docs/decisiones.md) — ADRs.
- [docs/glosario.md](docs/glosario.md) — jerga sindical y aeronáutica.

### Módulo Agenda (en planificación)

Módulo nuevo de agenda interna del Secretariado (eventos por WhatsApp, convocatorias con botones, recordatorios escalonados, feeds iCal, integración con el reporte semanal). Arquitectura cerrada el 2026-06-07; sin código aún. Toda la doc en `docs/modulo-agenda/`:

- [docs/modulo-agenda/README.md](docs/modulo-agenda/README.md) — panorama + las 8 decisiones de arquitectura.
- [docs/modulo-agenda/plan-implementacion.md](docs/modulo-agenda/plan-implementacion.md) — 9 fases (A1–A9), empezar por A1.
- [docs/modulo-agenda/analisis-proyecto-existente.md](docs/modulo-agenda/analisis-proyecto-existente.md) — qué se reutiliza del sistema base.
- [docs/modulo-agenda/modelo-de-datos.md](docs/modulo-agenda/modelo-de-datos.md), [workflows-n8n.md](docs/modulo-agenda/workflows-n8n.md), [prompts.md](docs/modulo-agenda/prompts.md), [endpoints-api.md](docs/modulo-agenda/endpoints-api.md), [componentes-ui.md](docs/modulo-agenda/componentes-ui.md), [riesgos.md](docs/modulo-agenda/riesgos.md).
