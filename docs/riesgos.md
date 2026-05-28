# Riesgos identificados y mitigaciones

Lista honesta, en orden aproximado de criticidad. Cada riesgo con: probabilidad, impacto, mitigación, plan B.

---

## R1 — Evolution API: ban del número por Meta

- **Probabilidad**: Media-alta (es la naturaleza de la solución no oficial).
- **Impacto**: Crítico. Sin canal de mensajes, el sistema entero deja de funcionar.
- **Mitigación**:
  - Usar un **chip dedicado**, no el personal de nadie. Si lo banean, banean un número aislado.
  - **No** mandar mensajes a números no registrados (descartar mensajes entrantes de desconocidos).
  - Throttling: máximo 30 mensajes/hora salientes, 2s entre cada uno.
  - Patrón de mensajes "humano": evitar templates idénticos enviados en masa en segundos.
  - Activar el trámite de **Meta Cloud API en paralelo** desde el día 1, no esperar a que pase algo.
- **Plan B**: si baneo, conmutar a otro chip (mantener uno de reserva ya vinculado a Evolution). Si se vuelve recurrente, acelerar la migración a Meta Cloud API.

---

## R2 — Meta Cloud API: el trámite se traba

- **Probabilidad**: Media.
- **Impacto**: Alto en largo plazo (quedamos con Evolution más tiempo del esperado).
- **Mitigación**:
  - Empezar el trámite **ya**, día 1 del proyecto.
  - Tener un Business Manager de Meta a nombre de ATEPSA con documentación completa (CUIT, comprobante de domicilio, autoridades del sindicato).
  - Mantener el flujo del adapter para que la conmutación sea inmediata cuando llegue.
- **Plan B**: si Meta rechaza, evaluar Twilio WhatsApp (más caro, rompe parcial soberanía pero es robusto) o WhatsApp Business app + Click-to-Chat para flows más simples.

---

## R3 — Llamadas a Claude API se loopean y queman presupuesto

- **Probabilidad**: Baja-media (puede pasar con bugs).
- **Impacto**: Medio (presupuesto controlado, pero costo inesperado).
- **Mitigación**:
  - Rate limiting por workflow en n8n: máximo N llamadas/hora a Claude.
  - Endpoint `POST /api/internal/ai/*` valida cuotas: si el ciclo activo ya consumió > X dólares, falla con 429.
  - Alertas a Julián si en una hora se gastan > USD 2.
  - Tabla `ai_invocations` con costo por llamada, dashboard de gasto en `/admin`.
- **Plan B**: kill switch global desde `system_settings.ai_disabled=true` que hace que todos los endpoints AI devuelvan 503.

---

## R4 — VPS down (hardware, red, proveedor)

- **Probabilidad**: Baja.
- **Impacto**: Crítico. Sin VPS, no hay nada.
- **Mitigación**:
  - Backups diarios de Postgres con `pg_dump` a `/backups/` (rotación 30 días).
  - **Backup semanal externo**: snapshot completo (DB + audios + .env) cifrado y subido a un storage offsite (definir con Julián: ¿drive del sindicato? ¿cuenta personal? Hace falta que sea cifrado).
  - Documentar restore en `infra/scripts/restore.sh` con steps detallados.
  - Plan de "VPS nuevo en 4 horas": Dockerfile + compose hacen que en un VPS nuevo con `git clone + docker compose up -d + restore.sh backup.sql` esté operativo.
- **Plan B**: snapshot del proveedor de VPS si lo soporta. Si no, el backup offsite es el seguro.

---

## R5 — faster-whisper en CPU es lento bajo carga

- **Probabilidad**: Media (depende de cuántos audios lleguen el viernes a último momento).
- **Impacto**: Bajo-medio. Transcripciones tardan, repreguntas no salen a tiempo, peor experiencia.
- **Mitigación**:
  - Modelo `medium` es buen tradeoff (no `large`).
  - `compute_type=int8` para acelerar 2-3x en CPU.
  - Semaphore de 2 jobs concurrentes para no tirar RAM.
  - Cola por user: si user manda 3 audios seguidos, se procesan secuencialmente, no en paralelo.
- **Plan B**: si la carga real desborda, evaluar:
  - Modelo `small` (3x más rápido, calidad aún aceptable para español claro).
  - GPU en el VPS si el proveedor lo permite.
  - Servicio externo (Deepgram, Replicate) — rompe soberanía, último recurso.

---

## R6 — Calidad de outputs de IA insuficiente

- **Probabilidad**: Media (sobre todo en las primeras 4 semanas).
- **Impacto**: Medio. Si los drafts son malos, Julián los reescribe entero y la herramienta pierde valor.
- **Mitigación**:
  - Iterar prompts con feedback real (ver `prompts-strategy.md` sección iteración).
  - Editor inline en el panel para correcciones rápidas.
  - Few-shot examples curados con casos reales de ATEPSA.
  - Si Haiku queda corto en alguna tarea, escalar a Sonnet sin drama (costo igual sigue bajo).
- **Plan B**: deshabilitar generación de drafts (`system_settings.publications_enabled=false`) y dejar solo el consolidado interno mientras se afina.

---

## R7 — Adopción: secretarios no reportan

- **Probabilidad**: Alta (es un cambio cultural).
- **Impacto**: Alto. Sin reportes, no hay sistema.
- **Mitigación** (no técnica, pero hay que decirla):
  - Onboarding humano: Julián habla con cada uno, les explica el sentido.
  - Mensaje inicial cálido y claro, no burocrático.
  - Política de no-persecución (ver `workflows.md` sección escalation).
  - Reconocimiento: el consolidado firmado los visibiliza, eso refuerza la conducta.
- **Plan B**: si en 6 semanas el cumplimiento es < 50%, sentarse con el Secretario General a repensar el mecanismo (¿reuniones grabadas en vez de reportes? ¿reportes mensuales en vez de semanales?).

---

## R8 — Información sensible filtrada en outputs públicos

- **Probabilidad**: Baja-media (la IA puede malclasificar `is_public_safe`).
- **Impacto**: Crítico reputacional/político.
- **Mitigación**:
  - **Revisión humana obligatoria** antes de publicar — esto es la mitigación principal.
  - El prompt de extracción incluye guía clara sobre qué marcar como sensible.
  - Los drafts públicos solo incluyen items con `is_public_safe=true` (doble filtro).
  - En el panel de revisión, los items marcados como sensibles se muestran en rojo para que Julián vea qué fue excluido.
- **Plan B**: si pasa algo grave, postmortem y endurecer el filtro. Eliminar el output del canal donde se publicó.

---

## R9 — OTP de WhatsApp como SPOF para login

- **Probabilidad**: Baja.
- **Impacto**: Medio. Si el bot está caído, nadie puede loguearse.
- **Mitigación**:
  - Sesiones largas (30 días) para que no haga falta loguear seguido.
  - Endpoint admin para que Julián genere tokens de bypass en emergencia.
  - Cuando migremos a Meta Cloud API (más estable), riesgo baja a casi cero.
- **Plan B**: fallback a email + magic link configurable desde `system_settings` si se vuelve recurrente.

---

## R10 — Drizzle migrations conflictivas o irreversibles

- **Probabilidad**: Baja.
- **Impacto**: Medio-alto en producción.
- **Mitigación**:
  - Toda migración se prueba en local primero con `pnpm drizzle-kit generate` + revisión del SQL.
  - Backup automático **antes** de cada deploy que incluya migración.
  - Script de deploy con flag `--migrate` separado del deploy normal: nunca se migra sin querer.
- **Plan B**: restore del backup pre-migration + revertir el commit.

---

## R11 — n8n self-hosted: pérdida de workflows al actualizar versión

- **Probabilidad**: Baja-media (n8n a veces tiene breaking changes).
- **Impacto**: Medio. Hay que reimportar workflows.
- **Mitigación**:
  - Todos los workflows versionados como JSON en `n8n/workflows/`.
  - Pinear versión de n8n en `docker-compose.yml` (no usar `:latest`).
  - Antes de actualizar, leer changelog y probar en staging local.
- **Plan B**: rollback de versión + reimport desde git.

---

## R12 — Conflicto entre n8n y la app por el mismo Postgres

- **Probabilidad**: Baja.
- **Impacto**: Medio (corrupción, deadlocks).
- **Mitigación**:
  - n8n usa schema separado `n8n`, no `public`.
  - Roles de DB separados: `app_user` solo accede a `public`, `n8n_user` solo a `n8n`.
  - Connection pool dimensionado: n8n max 5 conexiones, app max 20.
- **Plan B**: si hay conflicto, partir en dos instancias de Postgres en el mismo container.

---

## R13 — Performance: dashboard ejecutivo es lento

- **Probabilidad**: Baja al inicio, sube con el tiempo.
- **Impacto**: Bajo (mal UX, no rompe nada).
- **Mitigación**:
  - Índices apropiados desde el inicio (ver `modelo-de-datos.md`).
  - Vistas materializadas para la matriz de cumplimiento si crece (no MVP).
- **Plan B**: refactor de queries cuando duela.

---

## R14 — TypeScript types desync con DB schema

- **Probabilidad**: Baja con Drizzle.
- **Impacto**: Bugs en runtime.
- **Mitigación**:
  - Drizzle infiere tipos del schema, no hay duplicación manual.
  - CI corre `pnpm typecheck` en cada PR.

---

## R15 — Dependencia de Anthropic (cambio de precios, deprecation de modelos)

- **Probabilidad**: Baja-media en horizonte de 2-3 años.
- **Impacto**: Medio.
- **Mitigación**:
  - Los slugs de prompt están abstractos del modelo concreto (config en DB).
  - El cliente AI está centralizado, cambiar provider sería una capa.
- **Plan B**: si Anthropic se vuelve inviable, evaluar Llama 3.1 local (requiere GPU) o OpenAI. Romperíamos soberanía con OpenAI pero el wiring es similar.

---

## Riesgos descartados o aceptados

- **No tener tests al inicio**: aceptado para MVP. Riesgo: regresiones. Mitigación: TypeScript estricto + revisión manual + el sistema es chico. Tests obligatorios desde Fase 7.
- **No tener CI/CD complejo**: aceptado. Deploy es `git pull && docker compose up -d --build` en el VPS. Suficiente para esta escala.
- **No multi-tenant**: ATEPSA es el único cliente. Si en el futuro otro gremio lo quiere, refactor mayor (asumido).
