# ATEPSA — Sistema de Reporte Semanal del Secretariado

Sistema interno de reporte semanal con asistencia de IA para el Secretariado Nacional de ATEPSA (Asociación Técnicos y Empleados de Protección y Seguridad a la Aeronavegación).

Los secretarios reportan su actividad semanal por WhatsApp (audio o texto). El sistema transcribe, extrae, consolida y genera tres salidas comunicacionales (resumen interno, piezas para redes, newsletter/web) que la Secretaría de Prensa revisa antes de publicar.

---

## Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Orquestación | n8n self-hosted (Docker) | Reemplaza Make. Cero dependencia de Google OAuth. Workflows visuales versionables. |
| Base de datos | PostgreSQL 16 local | Reemplaza Google Sheets. Soberanía total. |
| WhatsApp | Evolution API (Docker) → Meta Cloud API | Empezamos con Evolution para MVP, migramos a Meta Cloud API cuando esté aprobado el alta. |
| Transcripción | faster-whisper (Python, CPU) | Local, cero costo por minuto, modelo `medium` en español. |
| IA generativa | Claude API (Anthropic) | Haiku 4.5 para extracción y clasificación, Sonnet 4.6 para redacción final. |
| Panel web | Next.js 14 (App Router) + shadcn/ui + Tailwind | TypeScript estricto. |
| Auth | Auth.js + OTP por WhatsApp | Reutiliza el canal del bot, cero passwords. |
| ORM | Drizzle | Type-safe, migraciones por código. |
| Proxy / HTTPS | Caddy | Auto-HTTPS, config mínima. |
| Storage | Disco local del VPS | Audios y documentos generados. |

Todo en español, todo soberano en el VPS de ATEPSA. Única salida: llamadas a la API de Claude.

---

## Estructura del repo

```
atepsa-reportes/
├── apps/
│   └── web/                # Next.js — panel web + API interna que consume n8n
├── services/
│   └── transcriber/        # Python + FastAPI + faster-whisper
├── n8n/
│   └── workflows/          # Exports JSON de los workflows (versionados)
├── infra/
│   ├── docker-compose.yml  # n8n, postgres, evolution, transcriber, web, caddy
│   ├── caddy/              # Caddyfile
│   └── scripts/            # deploy, backup, restore
├── docs/                   # Arquitectura, modelo de datos, decisiones
└── CLAUDE.md               # Contexto para sesiones de Claude Code
```

---

## Cómo correrlo (esquemático)

> Esta sección se completa a medida que avancen las fases. Hoy es solo el bosquejo.

### Desarrollo local

```bash
# 1. Postgres + Evolution + n8n en Docker
cd infra && docker compose up -d postgres evolution n8n

# 2. Transcriber en Docker (opcional en dev, puede ser stub)
docker compose up -d transcriber

# 3. Web app
cd apps/web && pnpm install && pnpm dev
```

### Producción (VPS)

```bash
cd /opt/atepsa-reportes
git pull
cd infra && docker compose up -d --build
```

Detalle completo en [`docs/plan-implementacion.md`](docs/plan-implementacion.md).

---

## Documentación

- [`CLAUDE.md`](CLAUDE.md) — Contexto e instrucciones para sesiones con Claude Code.
- [`docs/decisiones.md`](docs/decisiones.md) — Decisiones de diseño tomadas y por qué.
- [`docs/arquitectura.md`](docs/arquitectura.md) — Arquitectura completa con diagramas.
- [`docs/modelo-de-datos.md`](docs/modelo-de-datos.md) — Schema conceptual de la base.
- [`docs/workflows.md`](docs/workflows.md) — Workflows de n8n.
- [`docs/prompts-strategy.md`](docs/prompts-strategy.md) — Modelos de Claude por tarea.
- [`docs/plan-implementacion.md`](docs/plan-implementacion.md) — Fases y orden de trabajo.
- [`docs/riesgos.md`](docs/riesgos.md) — Riesgos identificados y mitigaciones.
- [`docs/glosario.md`](docs/glosario.md) — Jerga sindical y aeronáutica para la IA.

---

## Convenciones

- **Idioma**: documentación en español, código (variables, funciones, comentarios técnicos) en inglés.
- **TypeScript**: estricto, sin `any`, sin `// @ts-ignore` salvo justificación en comentario.
- **Commits**: mensaje en español, presente imperativo (`agrega validación de OTP`, `corrige timeout en transcriber`).
- **Branches**: `main` estable, features en `feat/<nombre>`, fixes en `fix/<nombre>`.
- **Code review**: opcional para MVP (somos pocos), obligatorio cuando entre otra persona al repo.

---

## Licencia y propiedad

Repo privado, propiedad de ATEPSA. Uso interno exclusivo.
