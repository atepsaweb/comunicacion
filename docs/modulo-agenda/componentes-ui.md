# Componentes UI — Módulo Agenda

Reutiliza la infraestructura del panel:
- `PanelShell` + `SidebarNav` (solo se agregan ítems).
- `Card`/`CardHeader`/`CardContent`, `Button`, `Input`, `Label` (lo único instalado de shadcn).
- Patrón **page.tsx server** (fetch + auth) + **`*-client.tsx`** para interacción (como `ausencias`, `usuarios`).
- Paleta: sidebar `#2E3863`, contenido en zinc. Fechas con `toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })` (ver `dashboard/page.tsx:formatCloseDate`).

Dependencia nueva (decisión 2): **`react-big-calendar` + `date-fns`** para la grilla del calendario. Localizer `date-fns` con locale `es`. Estilos custom para alinear con la paleta ATEPSA.

---

## Mapa de rutas nuevas

| Ruta | Quién | Qué |
|---|---|---|
| `/agenda` | todos | Calendario (vista principal: semana). Switcher de vistas. |
| `/agenda/[id]` | según visibilidad | Detalle del evento + tablero de confirmaciones. |
| `/agenda/nuevo` | todos (form adapta por rol) | Alta de evento desde panel (o modal sobre `/agenda`). |
| `/agenda/propuestas` | exec/press_admin | Bandeja de propuestas pendientes. |
| `/mi-calendario` | todos | Gestión de los 3 tokens iCal + preferencias de notificación (sección de perfil). |

---

## Sidebar (`components/sidebar-nav.tsx`)

Agregar al array `navItems` (con `dividerBefore` en el primero para separar sección):

```ts
{ label: 'Agenda',         href: '/agenda',            icon: Calendar,      dividerBefore: true },
{ label: 'Propuestas',     href: '/agenda/propuestas', icon: CalendarClock, roles: ['executive','press_admin'] },
{ label: 'Mi calendario',  href: '/mi-calendario',     icon: CalendarPlus },
```

Iconos de `lucide-react` (ya es dependencia): `Calendar`, `CalendarClock`, `CalendarPlus`.

---

## `/agenda` — Calendario (vista principal)

**page.tsx (server)**: sesión + fetch inicial de eventos del rango visible (`GET /api/agenda/events`).
**agenda-client.tsx (client)**:
- `react-big-calendar` con vistas `week` (default), `month`, `day`, `agenda` (lista).
- Switcher extra (botones propios, estilo del panel): **Todos / Mis eventos / Movilizaciones** → filtra client-side o re-fetch con `?type=`/`?view=mine`.
- Colores por `type`: `personal` (zinc), `secretariat` (azul `#2E3863`), `mobilization` (un acento, ej. ámbar/rojo sobrio). Sin estridencias (identidad ATEPSA).
- Click en evento → navega a `/agenda/[id]` (o popover con resumen + link).
- Botón "Nuevo evento" → `/agenda/nuevo` o modal.
- Eventos `proposed` solo se ven si el rol es exec/press_admin, con estilo "tenue/punteado".

> Trade-off de `react-big-calendar`: potente para month/week, pero su CSS hay que sobrescribirlo bastante para que respete la paleta y el responsive mobile (el panel es mobile-first, ver `PanelShell`). Presupuestar tiempo de estilado. La vista `agenda` (lista) de la librería es la mejor para mobile.

---

## `/agenda/[id]` — Detalle + tablero

**page.tsx (server)**: fetch evento + `GET /api/agenda/events/:id/attendees`.
**client**:
- Card con datos del evento (título, tipo, fecha/hora ART, lugar, descripción, creador, estado).
- Acciones según rol/estado:
  - Creador o exec/press_admin: Editar, Cancelar, (Reprogramar = editar fecha).
  - `proposed` + exec/press_admin: Aprobar / Rechazar.
  - Cualquier convocado: botones de asistencia (Voy / No puedo / Tal vez) vía `POST .../attendance`.
- **Tablero de confirmaciones** (si `requires_confirmation`): grilla de los 27 con estado coloreado (verde `going`, rojo `not_going`, ámbar `maybe`, gris `no_response`, azul tenue `on_leave`). Resumen arriba (contadores). Filtrable por estado. Botón "Descargar Excel" → `/api/agenda/board.xlsx?eventId=` (patrón `DownloadXlsxButton`).

---

## `/agenda/nuevo` — Alta desde panel

Form con `Input`/`Label`/`Button`:
- Título, descripción (textarea), tipo (select), fecha/hora inicio y fin, todo-el-día (check), lugar.
- Si `type !== 'personal'`: toggle "requiere confirmación" + selector de recordatorios (checkboxes 7d/24h/12h/2h/followup) con el **tope de 4** validado en cliente (deshabilita el 5º).
- Si el rol es `executive`/`press_admin`: toggle **"Importante (no se puede silenciar)"** → setea `is_important`. Oculto para `secretary`. En `mobilization` viene marcado por default.
- Aviso contextual: si el rol es `secretary` y el tipo es institucional → "Esto se enviará como propuesta a la Mesa Ejecutiva".
- Submit → `POST /api/agenda/events`.

---

## `/agenda/propuestas` — Bandeja (exec/press_admin)

- `notFound()` si el rol no corresponde (patrón de `estadisticas/page.tsx`).
- Lista de eventos `proposed` (Cards): proponente, datos, fecha de propuesta.
- Acciones inline: Aprobar / Rechazar (con razón). Optimistic update + re-fetch.
- Contador de pendientes (se puede surfacear en el dashboard como las "publicaciones a revisar").

---

## `/mi-calendario` — Tokens iCal + preferencias (perfil)

**Bloque A — Suscripción iCal**:
- Tres bloques (uno por scope: Completo / Secretariado / Personales).
- Por bloque: URL del feed (read-only, con botón Copiar), `last_accessed_at`, botón **Regenerar** (revoca y crea nuevo) y **Revocar**.
- Instrucciones de suscripción (Google Calendar / Apple / Outlook): "Pegá esta URL en "Suscribirse a un calendario / Add by URL". Es de solo lectura."
- Advertencia: "Si perdés el control de la URL, regenerala: la anterior deja de funcionar al instante."

**Bloque B — Preferencias de notificación** (R1):
- Por tipo de evento (Secretariado / Movilización), checkboxes de qué recordatorios querés recibir (7d/24h/12h/2h).
- Nota fija: "Los eventos marcados como **Importantes** por la Mesa Ejecutiva o Prensa se envían siempre, no se pueden silenciar."
- Submit → `PUT /api/agenda/notification-prefs`.

---

## Integración con el dashboard existente (`/dashboard`)

Sumar (sin rediseñar) una card:
- **secretary**: "Tus próximos eventos" (los suyos confirmados de los próximos 7 días).
- **exec/press_admin**: "Propuestas pendientes" (contador → `/agenda/propuestas`), análogo a "Publicaciones a revisar".

---

## Responsive / mobile

El panel es mobile-first (drawer en `PanelShell`). El calendario es lo más delicado en mobile: usar la vista `agenda`/lista de `react-big-calendar` como default en pantallas chicas, y week/month en desktop. El tablero de 27×estados se vuelve scroll horizontal en mobile (igual que la matriz de cumplimiento).
