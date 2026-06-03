# Decisiones de diseño (ADRs)

Registro liviano de decisiones tomadas. Cada una con contexto, opciones consideradas, decisión final y consecuencias. **No se cambia una decisión sin actualizar este archivo.**

---

## ADR-001 — Stack soberano sobre VPS propio

**Fecha**: 2026-05-27
**Estado**: Aceptada

### Contexto
ATEPSA necesita un sistema que maneje información sensible de actividad gremial (conflictos, estrategia, nombres de afiliados). El sindicato ya tiene un VPS propio con capacidad ociosa. Hay una preferencia política e ideológica explícita por soberanía de datos.

### Opciones consideradas
1. **Stack cloud-first** (Vercel + Supabase + servicios SaaS).
2. **Híbrido** (DB y bot en VPS, web en Vercel).
3. **Todo en VPS propio** ← elegida.

### Decisión
Todo el sistema corre en el VPS de ATEPSA. La única conexión saliente es a la API de Anthropic (Claude). Postgres, n8n, Evolution API, transcriber, panel web y proxy reverso, todo en Docker en la misma máquina.

### Consecuencias
- ✅ Cero dependencia operativa de servicios externos.
- ✅ Cero costos recurrentes salvo Claude API.
- ✅ Coherente con la cultura del proyecto.
- ⚠️ El VPS es punto único de falla. Mitigación: backups automáticos diarios, monitoreo, plan de restore documentado.
- ⚠️ Toda la operación de infra recae internamente. Mitigación: docker-compose simple, scripts de deploy versionados.

---

## ADR-002 — n8n como orquestador

**Fecha**: 2026-05-27
**Estado**: Aceptada

### Contexto
Necesitamos un orquestador para los flujos semanales (disparos por cron, webhooks de WhatsApp, encadenamiento de llamadas a Claude, manejo de errores y reintentos).

### Opciones consideradas
1. **Make / Zapier** — descartado por dependencia cloud y costo recurrente.
2. **Código TypeScript puro** con cron jobs (BullMQ, agenda) — más control, pero todo el versionado y monitoreo a mano.
3. **n8n self-hosted** ← elegida.
4. **Temporal** — overkill para la escala.

### Decisión
n8n self-hosted en Docker, con Postgres como backend de estado (la misma instancia que la app, schema separado `n8n`).

### Consecuencias
- ✅ Visual, fácil de modificar flujos sin tocar código.
- ✅ Tiene nodos para HTTP, webhooks, cron, Postgres, etc.
- ✅ Comunidad grande, mucha documentación.
- ⚠️ Versionado de workflows requiere exportar JSON manualmente. Mitigación: convención de exportar a `n8n/workflows/` antes de cada commit que toque flujos.
- ⚠️ Curva de aprendizaje inicial. Mitigación: documentar cada workflow en `docs/workflows.md`.

---

## ADR-003 — WhatsApp: Evolution primero, Meta Cloud después

**Fecha**: 2026-05-27
**Estado**: Aceptada (con plan de migración)

### Contexto
Necesitamos enviar y recibir mensajes (texto y audio) por WhatsApp con 27 secretarios. La API oficial de Meta Cloud requiere alta de Business Account, verificación, número dedicado y 1-3 días hábiles de trámite.

### Opciones consideradas
1. **Meta Cloud API oficial directo** — robusto, gratis hasta 1000 conv/mes, pero bloquea el MVP por días.
2. **Evolution API self-hosted** (usa Baileys bajo el capó) — rápido de levantar pero Meta puede banear el número.
3. **Twilio WhatsApp** — caro y rompe soberanía.

### Decisión
**Fase MVP**: Evolution API self-hosted. En paralelo, arrancar trámite de Meta Cloud API.
**Fase producción estable**: migrar a Meta Cloud API.

La arquitectura del bot se diseña con un **adapter pattern** (`WhatsAppProvider` interface) para que la migración sea cambiar la implementación, no reescribir.

### Consecuencias
- ✅ MVP desbloqueado en días, no semanas.
- ✅ Migración planificada, no de emergencia.
- ⚠️ Durante Evolution: riesgo de ban del número. Mitigación: usar un chip dedicado (no el personal de Julián), avisar a los 27 que es solución temporal, no enviar más de N mensajes/día.
- ⚠️ Adapter pattern suma una capa de abstracción. Justificada por la migración planeada.

---

## ADR-004 — Login por OTP de WhatsApp

**Fecha**: 2026-05-27
**Estado**: Aceptada

### Contexto
27 usuarios, mayoría no técnicos. Necesitan loguearse al panel web ocasionalmente (consultar sus reportes, gestionar ausencias).

### Opciones consideradas
1. **Email + password** — fricción de resets, necesita SMTP, los usuarios olvidan passwords.
2. **Magic link por email** — depende de SMTP, los mails caen en spam.
3. **OTP por WhatsApp** ← elegida.

### Decisión
El usuario ingresa su número en el panel, recibe un código de 6 dígitos por WhatsApp (enviado por el mismo bot), lo ingresa, entra. Sesión de 30 días en cookie httpOnly.

### Consecuencias
- ✅ Cero passwords que recordar/recuperar.
- ✅ Reutiliza la infra del bot.
- ✅ El número de WhatsApp ya es el identificador del usuario en el sistema.
- ⚠️ Si pierden el número (cambio de chip), pierden acceso. Mitigación: admin puede actualizar número desde el panel.
- ⚠️ Mientras estemos en Evolution, si el bot está caído nadie puede loguearse. Mitigación: durante outages, Julián como admin puede generar tokens de bypass.

---

## ADR-005 — Modelos de Claude: Haiku para extracción, Sonnet para redacción

**Fecha**: 2026-05-27
**Estado**: Aceptada (revisable según calidad observada)

### Contexto
Hay varias tareas de IA con perfiles distintos: extracción estructurada de reportes (clasificación + JSON), repreguntas conversacionales, síntesis consolidada interna, redacción para redes (con tono y estilo), redacción de newsletter.

### Decisión
Detalle completo en [`prompts-strategy.md`](prompts-strategy.md). Resumen:
- **Haiku 4.5**: extracción, clasificación, detección de "reporte incompleto", generación de repreguntas.
- **Sonnet 4.6**: síntesis consolidada interna, redacción de piezas para redes, redacción de newsletter.

### Consecuencias
- ✅ Costo mínimo (~USD 5-15/mes estimado).
- ✅ Calidad alta donde importa (outputs públicos pasan por Sonnet).
- ⚠️ Si la calidad de extracción con Haiku no es suficiente, escalamos a Sonnet ahí también. Revisar a las 4 semanas de uso real.

---

## ADR-006 — Outputs sin integración automática (copy/paste manual)

**Fecha**: 2026-05-27
**Estado**: Aceptada (revisable)

### Contexto
Los outputs finales (resumen interno, piezas para redes, newsletter) deben publicarse en distintos canales: Instagram, Facebook, X, web del sindicato, mail a afiliados.

### Opciones consideradas
1. **Integración automática** vía Meta Graph API, X API, SMTP, CMS de la web.
2. **Copy/paste manual** desde el panel ← elegida.

### Decisión
El panel muestra los outputs listos (texto, imágenes, formato). Julián los copia y pega manualmente a cada plataforma. Cero OAuth con terceros. Cero SMTP. Cero CMS.

### Consecuencias
- ✅ Máxima soberanía y control humano.
- ✅ Cero superficie de ataque por credenciales de terceros.
- ✅ Cero riesgo de "el bot publicó algo raro a las 3 AM".
- ⚠️ Fricción manual recae en Julián. Mitigación: panel con botones de "copiar al portapapeles" por canal, formato adaptado a cada uno (caracteres de X, hashtags de IG, etc.).
- 🔄 **Revisable**: si la fricción manual se vuelve insoportable, evaluar integración con un solo canal (probable: newsletter por mail).

---

## ADR-007 — Reportes firmados por autor (transparencia interna)

**Fecha**: 2026-05-27
**Estado**: Aceptada

### Contexto
El consolidado semanal interno (que vuelve a los 27 el lunes) puede ser anónimo (solo temas) o firmado (cada ítem dice quién lo reportó).

### Decisión
**Firmados internamente**: cada ítem en el consolidado del lunes dice quién lo reportó. Los outputs públicos (redes, newsletter, web) **no incluyen autoría** por defecto.

### Consecuencias
- ✅ Refuerza accountability y reconocimiento dentro del Secretariado.
- ✅ Facilita coordinación: "lo que reportó X la semana pasada conecta con lo que estoy haciendo yo".
- ⚠️ Puede generar comparaciones incómodas (quién reporta más, quién menos). Mitigación: la política de no-reporte (ver `workflows.md`) es deliberadamente compasiva.

---

## ADR-008 — GitHub privado como repo

**Fecha**: 2026-05-27
**Estado**: Aceptada

### Contexto
Necesitamos versionar el código.

### Decisión
GitHub privado. El repo no contiene datos sensibles (todo eso vive en la DB del VPS), solo código + docs + workflows JSON.

### Consecuencias
- ✅ Integración con Claude Code, CI/CD, etc.
- ⚠️ Repo está en infra de Microsoft. Aceptable: no hay datos personales ni de afiliados en el repo.
- ⚠️ Si alguna vez se decide migrar a Gitea/Forgejo self-hosted, es trivial (git remote add + push).

---

## ADR-009 — Monorepo simple, sin pnpm workspaces

**Fecha**: 2026-05-27
**Estado**: Aceptada

### Contexto
El proyecto tiene componentes en distintos lenguajes (Next.js en TypeScript, transcriber en Python). Se evaluó si conviene monorepo con pnpm workspaces y un orquestador tipo Turborepo.

### Decisión
**Monorepo plano, sin workspaces**. `apps/web` es una app Next.js autocontenida con su propio `package.json`. `services/transcriber` es un proyecto Python aparte con su propio `requirements.txt`. `n8n/workflows/` son solo JSONs. `infra/` tiene docker-compose y scripts.

### Consecuencias
- ✅ Simple, sin tooling extra.
- ✅ Cada componente se levanta independientemente.
- 🔄 Si en el futuro hay 2+ apps Node.js que comparten código, migrar a pnpm workspaces.

---

## ADR-010 — Migración de WAHA a Meta Cloud API con coexistencia por flag

**Fecha**: 2026-06-03
**Estado**: Aceptada

### Contexto
WAHA (whatsapp-web.js corriendo en Chromium headless) funcionó para arrancar pero arrastra riesgos: el cliente no oficial puede ser bloqueado por WhatsApp en cualquier momento, los multi-device quirks (`@lid`, `_data.type`, duplicación de eventos) consumen tiempo, y no hay SLA. Con las credenciales de Meta Cloud API ya emitidas para el número ATEPSA, corresponde mover el tráfico al canal oficial.

Restricciones del canal oficial:
- Mensajes proactivos (fuera de la ventana de 24h del usuario) exigen templates HSM previamente aprobados por Meta.
- No soporta envío a grupos.

### Opciones consideradas
1. **Switch directo en un PR**: simple pero sin rollback rápido si algo se rompe.
2. **Coexistencia con feature flag** ← elegida. Setting `whatsapp_provider` en DB decide en runtime; permite mover de `waha` a `meta` y volver atrás sin redeploy.
3. **Migración a Evolution API + Meta**: descartado, mantener dos proveedores no-oficiales no resuelve el problema de fondo.

### Decisión
- Setting `whatsapp_provider` (`waha` | `meta`) en `app.system_settings`. Lee el dispatcher en runtime (cache de 30s).
- Cliente Meta nuevo en `apps/web/src/lib/meta-cloud.ts` (sendText, sendTemplate, downloadMedia).
- Dispatcher en `apps/web/src/lib/whatsapp.ts` expone `sendWhatsAppText` (texto libre, solo válido en ventana 24h en Meta) y `sendWhatsAppTemplate` (proactivo con template + fallback).
- Webhook entrante de Meta en `/api/webhooks/meta`: valida `X-Hub-Signature-256` con `META_APP_SECRET`, normaliza el payload al formato existente, reenvía al webhook de n8n. Mantiene intacta la cadena de routing posterior (transcripción, extracción, classify-intent).
- Templates lógicos mapeados en setting `whatsapp_meta_templates`. Keys: `otp_login`, `weekly_kickoff`, `weekly_reminder`, `weekly_delivery`, `escalation_alert`. Los names tienen que coincidir exactamente con los aprobados en Business Manager.
- Eliminados los envíos a grupos (Meta Cloud API no los soporta): borrados los workflows `group-*.json` y el endpoint `/api/internal/group-notifications`.

### Consecuencias
- ✅ Canal oficial con SLA; eliminamos el riesgo de bloqueo de WhatsApp.
- ✅ Rollback inmediato cambiando el setting si el switch sale mal.
- ✅ Todos los workflows de n8n siguen funcionando sin cambios — solo el de escalation fue actualizado para pasar por el panel.
- ⚠️ Hasta que los templates estén aprobados, no se puede mover el setting a `meta`: los proactivos fallarían (Meta rechaza texto libre fuera de la ventana 24h con error 131047).
- ⚠️ Perdemos envío a grupos: la coordinación que iba al grupo del Secretariado ahora se distribuye via 1-a-1 (devolución del lunes) o se reemplaza por otros canales.
- 🔄 Después de un período estable con `whatsapp_provider=meta`, deprecar WAHA y bajar el container `wppconnect`.

---

## Cómo agregar una decisión nueva

1. Copiar el formato de ADR de arriba.
2. Numerarla secuencial (ADR-010, ADR-011...).
3. Estado: `Aceptada`, `Rechazada`, `Reemplazada por ADR-XXX`, `Revisable`.
4. Si una decisión nueva reemplaza una vieja, marcar la vieja como `Reemplazada por ADR-XXX` y dejarla en el archivo (no borrarla).
