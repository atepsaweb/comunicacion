# Plan de implementación

Diez fases. Cada fase tiene **objetivo**, **deliverables**, **criterio de aceptación** y **dependencias**.

**Cómo leer este doc en una sesión nueva con Claude Code**:
1. Identificá la fase actual (la primera que no tenga todos los items en ✅).
2. Mirá las dependencias: si algo previo no está, hacelo primero.
3. Cada fase es autocontenida: tiene todo lo que necesitás para implementarla.

---

## Estado actual

> **Fase 5** — pendiente. Fase 4 completada en Sesión 6 (2026-05-29).

---

## Fase 0 — Setup de infra y repo

**Objetivo**: tener el VPS preparado, repo creado, docker-compose listo, dominio y HTTPS funcionando.

**Tareas**:
- [x] Decidir stack y arquitectura (Sesión 1).
- [x] Generar docs base.
- [x] Crear repo en GitHub privado → `atepsaweb/comunicacion`.
- [x] Hacer `git init` local, primer commit con todo este scaffolding.
- [x] Confirmar specs del VPS: AlmaLinux 9.5, 2 cores, 7.5 GB RAM, 91 GB disco.
- [x] Apuntar subdominios al VPS: `panel.atepsa.org.ar`, `n8n.atepsa.org.ar`, `evolution.atepsa.org.ar`.
- [x] Instalar Docker 29.5.2 + Docker Compose v5.1.4 en el VPS.
- [x] Crear `/opt/atepsa-reportes/` en el VPS.
- [x] Clonar el repo en `/opt/atepsa-reportes/repo/`.
- [x] Crear `infra/docker-compose.yml` con postgres (sin Caddy — VPS tiene nginx compartido).
- [x] Configs nginx en `infra/nginx/*.conf` para los 3 subdominios (reemplaza Caddyfile).
- [x] `pg_dump` cron diario a las 3am + scripts backup.sh y restore.sh.
- [x] `.env.example` con todas las variables del sistema.
- [x] Copiar nginx configs al VPS y obtener certs SSL con certbot. Certs válidos hasta 2026-08-26, renovación automática activa.

**Criterio de aceptación**: `docker compose up -d` levanta Postgres y Caddy. `https://panel.atepsa.org.ar` responde (aunque sea 502).

**Bloquea**: todas las fases siguientes.

---

## Fase 1 — WhatsApp bot + n8n mínimo ✅

**Objetivo**: bot de WhatsApp recibe mensajes, llegan a n8n.

**Tareas**:
- [x] Agregar WAHA (whatsapp-web.js) al `docker-compose.yml` — Evolution API descartada (Baileys bloqueado por Meta).
- [x] Levantarlo, escanear QR con número de prueba (Al Toque Padel, temporal hasta tener número dedicado ATEPSA).
- [x] Configurar webhook hacia `https://n8n.atepsa.org.ar/webhook/whatsapp-inbound`.
- [x] Test manual: mensajes entrantes confirmados en n8n Executions.
- [x] Workflow `inbound-message-handle` importado y activo en n8n.

**Criterio**: ✅ mensajes que llegan al número del bot quedan logueados en n8n.

**Dependencias**: Fase 0.

---

## Fase 2 — DB schema + Next.js skeleton + auth OTP ✅

**Objetivo**: la app está corriendo, los 27 cargados, podés loguearte por OTP.

**Tareas**:
- [x] `apps/web/` con Next.js 14 (App Router), TypeScript estricto.
- [x] Drizzle ORM configurado contra Postgres.
- [x] Schema en `apps/web/src/db/schema/`: todas las tablas de `modelo-de-datos.md`.
- [ ] Primera migración: `pnpm db:generate` + `pnpm db:migrate` (correr en el VPS).
- [ ] Seed script: `DATABASE_URL=... pnpm db:seed /opt/atepsa-reportes/data/secretarios.csv`
- [x] NextAuth v4 con provider Credentials custom (OTP).
- [x] Flujo OTP:
  - `POST /api/auth/otp/request` → genera código, hashea, persiste en `otp_codes`, envía por WhatsApp.
  - Verificación vía Credentials provider de NextAuth.
- [x] UI mínima: `/login` con form de teléfono → form de OTP. `/dashboard` con placeholder según rol.
- [x] Layout base con sidebar, header (shadcn/ui manual).
- [x] Middleware de auth: redirige a login si no hay sesión.
- [x] Servicio `web` en docker-compose, nginx proxy a `:3001`.
- [ ] Deploy en VPS: `docker compose build web && docker compose up -d web`.

**Criterio**: entrás a `https://panel.atepsa.org.ar/login`, metés tu número, recibís código por WhatsApp, entrás, ves dashboard vacío.

**Dependencias**: Fase 0, Fase 1.

---

## Fase 3 — Recepción y transcripción de mensajes

**Objetivo**: cuando un secretario manda audio o texto, queda persistido y transcrito en la DB.

**Tareas**:
- [x] `services/transcriber/` con FastAPI + faster-whisper.
- [x] Dockerfile del transcriber. Modelo `medium` precargado en build.
- [x] Endpoint `POST /transcribe { path }` → devuelve `{ text, duration_sec }`.
- [x] Encolado simple con semaphore (max 2 jobs concurrentes).
- [x] Endpoint interno en la app `POST /api/internal/messages/inbound`:
  - Valida shared secret.
  - Parsea payload de WAHA (adaptado: era Evolution en el doc original).
  - Si es audio: descarga el archivo a `/data/audio/inbound/` con nombre `{cycleId}/{userId}/{messageId}.ogg`.
  - Resuelve `user_id` por `from_phone_e164`.
  - Persiste en `inbound_messages`.
  - Devuelve metadata para que n8n decida próximos pasos.
- [x] Endpoint `POST /api/internal/messages/:id/attach-transcription`.
- [x] Workflow `inbound-message-handle` fase 3:
  - webhook → POST inbound → branch discarded → branch audio → POST transcriber → POST attach-transcription.
  - Exportado en `n8n/workflows/inbound-message-handle.json`.
- [x] UI: vista `/mis-mensajes` lista los mensajes propios con transcripción.

**Criterio**: mandás un audio de 30s al bot, en 1-2 min aparece transcrito en la UI.

**Dependencias**: Fase 1, Fase 2.

---

## Fase 4 — Extracción con IA (Haiku)

**Objetivo**: cada mensaje genera/actualiza un `report` con items estructurados.

**Tareas**:
- [x] `apps/web/src/lib/ai/client.ts`: cliente Anthropic con caching habilitado, retry, logging a `ai_invocations`.
- [x] `apps/web/src/lib/ai/prompts/extract-report.ts`: prompt versionado con system, ejemplos, user template.
- [x] `apps/web/src/lib/ai/prompts/classify-intent.ts`: prompt de clasificación de intención.
- [ ] Seed inicial de `prompts` con los prompts del repo.
- [x] Endpoint `POST /api/internal/ai/classify-intent`.
- [x] Endpoint `POST /api/internal/ai/extract`:
  - Toma el texto + report previo (si hay).
  - Llama a Haiku.
  - Parsea JSON.
  - Mergea con report existente o crea uno nuevo (`status='draft'`).
  - Persiste `report_items`.
  - Devuelve `{ reportId, completenessScore }`.
- [x] Workflow `inbound-message-handle` extendido: post-transcripción llama a classify + extract.
- [x] UI: vista `/reportes/[id]` muestra los items extraídos, agrupados por categoría. También `/reportes` (lista).

**Criterio**: mandás 2 audios sobre temas distintos en la misma semana, la UI muestra 1 reporte con 2+ items categorizados.

**Dependencias**: Fase 3.

---

## Fase 5 — Repreguntas automáticas

**Objetivo**: si el reporte está incompleto, el bot repregunta.

**Tareas**:
- [ ] Endpoint `POST /api/internal/ai/assess-completeness`.
- [ ] Endpoint `POST /api/internal/ai/followup-question`.
- [ ] Lógica de límite: máximo 2 repreguntas por reporte por ciclo.
- [ ] Workflow `inbound-message-handle` extendido: si needs_followup y bajo límite → genera y envía pregunta, marca `report.status='awaiting_followup'`.
- [ ] Cuando llega una respuesta y el reporte está en `awaiting_followup`, se trata como `report_followup_reply` y se mergea.
- [ ] UI: en el detalle del reporte, mostrar el hilo de repreguntas.

**Criterio**: mandás un reporte escueto ("hablé con EANA"), el bot pregunta "¿cómo salió?", respondés, se incorpora al reporte.

**Dependencias**: Fase 4.

---

## Fase 6 — Ciclos semanales: triggers, recordatorios, cierre

**Objetivo**: el ciclo semanal opera completo sin intervención humana hasta el cierre.

**Tareas**:
- [ ] Endpoint `POST /api/internal/cycles/ensure`.
- [ ] Endpoint `GET /api/internal/cycles/current`.
- [ ] Endpoint `GET /api/internal/users/active-for-cycle/:id` (excluye licencias).
- [ ] Endpoint `POST /api/internal/cycles/:id/open` y `:id/close`.
- [ ] Workflow `cycle-bootstrap` (lunes 00:05).
- [ ] Workflow `weekly-trigger-send` (jueves 10:00).
- [ ] Workflow `weekly-reminder-send` (viernes 12:00).
- [ ] Workflow `weekly-cycle-close` (viernes 18:00).
- [ ] Gestión de ausencias: endpoints + workflow para parsear "vacaciones del X al Y" y "esta semana paso".
- [ ] UI: `/ausencias` con calendario simple, registrar/cancelar.

**Criterio**: dejás el sistema corriendo un jueves; jueves 10 recibís el disparo; viernes 12 si no respondiste recibís recordatorio; viernes 18 el ciclo cierra solo.

**Dependencias**: Fase 5.

---

## Fase 7 — Consolidación + drafts + revisión

**Objetivo**: el viernes 19 el sistema genera los outputs; sábado Julián los revisa en el panel; lunes salen.

**Tareas**:
- [ ] Endpoint `POST /api/internal/ai/consolidate`.
- [ ] Endpoint `POST /api/internal/ai/draft-publication?kind=...`.
- [ ] Workflow `weekly-process` (viernes 19:00).
- [ ] UI bandeja `/revision`:
  - Lista de publicaciones del ciclo activo.
  - Detalle con editor (markdown / textarea simple primero, después mejoramos).
  - Botones: "guardar versión", "aprobar", "descartar".
  - Cuando aprobás, marca `status='approved'`.
- [ ] Endpoint `POST /api/internal/publications/:id/approve` y `:id/discard`.
- [ ] Workflow `weekly-delivery-send` (lunes 08:00).
- [ ] UI lectura del consolidado: `/cycles/[id]` (accesible a todos los users).

**Criterio**: el sábado entrás al panel, ves el consolidado + 3 drafts, editás uno, los aprobás. El lunes los 27 reciben el consolidado por WhatsApp.

**Dependencias**: Fase 6.

---

## Fase 8 — Dashboard ejecutivo + escalación

**Objetivo**: la Mesa Ejecutiva tiene visibilidad de cumplimiento; las alertas escalonadas funcionan.

**Tareas**:
- [ ] UI `/ejecutivo/cumplimiento`: matriz user × últimas 12 semanas con celdas coloreadas (verde reportó, gris licencia, amarillo pausa, rojo no reportó).
- [ ] UI `/ejecutivo/estadisticas`: gráficos simples de items por categoría, evolución semanal.
- [ ] Endpoint `GET /api/exports/cumplimiento.xlsx`: genera Excel con la matriz.
- [ ] Workflow `escalation-check` (lunes 09:00).
- [ ] Notificación a Julián cuando alguien lleva 2 semanas sin reportar.
- [ ] Sección "Sin reporte recientemente" en el consolidado del lunes cuando aplica.

**Criterio**: la Mesa Ejecutiva puede entrar y ver de un vistazo quién reportó en las últimas 12 semanas. Las alertas escalonadas se generan automáticamente.

**Dependencias**: Fase 7.

---

## Fase 9 — Admin: prompts editables, gestión de usuarios, logs

**Objetivo**: Julián puede operar el sistema sin tocar código.

**Tareas**:
- [ ] UI `/admin/usuarios`: CRUD de los 27, alta/baja, cambio de rol, cambio de número.
- [ ] UI `/admin/prompts`: ver, editar (crea nueva versión), activar versión, ver historial.
- [ ] UI `/admin/logs/ia`: tabla de `ai_invocations` con filtros (purpose, modelo, ciclo, costo).
- [ ] UI `/admin/logs/audit`: tabla de `audit_log`.
- [ ] UI `/admin/settings`: edición de `system_settings` (categorías, horarios, modelos por slug).
- [ ] Botón "Re-procesar ciclo" en `/admin/cycles/[id]` que dispara `weekly-process` manualmente.

**Criterio**: Julián edita un prompt desde el panel, la próxima generación usa la versión nueva.

**Dependencias**: Fase 7.

---

## Fase 10 — Hardening + migración a Meta Cloud API

**Objetivo**: estabilidad de producción y migración del provider de WhatsApp.

**Tareas**:
- [ ] Implementar `MetaCloudProvider` que cumple `WhatsAppProvider`.
- [ ] Trámite con Meta para Business Account, verificación.
- [ ] Migrar el número (esto requiere coordinación con Meta).
- [ ] Cambiar `WHATSAPP_PROVIDER=meta` en `.env`, deploy.
- [ ] Backups: validar restore real (no solo que el pg_dump corre).
- [ ] Rate limiting en endpoints internos (por shared secret saturable).
- [ ] Monitoring básico: uptime check externo, alertas a Julián.
- [ ] Documentar runbook de emergencias: bot caído, postgres caído, claude API caído.

**Criterio**: el sistema corre con Meta Cloud API estable durante 4 semanas sin intervención.

**Dependencias**: Fase 9 y trámite completo con Meta.

---

## Qué se puede paralelizar

| Fase | Puede paralelizarse con |
|---|---|
| Fase 1 (Evolution) | Fase 2 (Next.js skeleton) si tenés capacidad de cambio de contexto |
| Fase 4 (extracción) | Fase 5 (repreguntas) — son extensiones, se pueden trabajar como una sola PR |
| Fase 8 (dashboard) | Fase 9 (admin) — ambas son UI sobre datos existentes |
| Fase 10 (Meta) | Cualquier fase posterior, el trámite avanza solo |

---

## Estimación de tiempo (con sesiones de Sonnet)

| Fase | Sesiones estimadas |
|---|---|
| Fase 0 | 1 |
| Fase 1 | 1 |
| Fase 2 | 2-3 |
| Fase 3 | 2 |
| Fase 4 | 2 |
| Fase 5 | 1 |
| Fase 6 | 2 |
| Fase 7 | 3 |
| Fase 8 | 2 |
| Fase 9 | 2 |
| Fase 10 | 2 + trámite |

**Total**: ~20-22 sesiones de trabajo enfocadas para llegar a producción completa.

MVP funcional mínimo (Fase 0 a 7): ~12-14 sesiones.

---

## Convenciones de PRs

- 1 PR por fase, salvo que la fase sea muy grande (Fase 2, Fase 7) → puede partirse.
- Cada PR actualiza este archivo marcando lo completado.
- Cada PR actualiza `docs/modelo-de-datos.md` si cambia el schema.
- Cada PR actualiza `docs/workflows.md` si toca workflows.
- Cada PR pasa typecheck + lint.
- Tests son opcionales en MVP, obligatorios desde Fase 7 para lógica de negocio crítica.
