# Workflows de n8n

Cada workflow se exporta a `n8n/workflows/<slug>.json` y se versiona en git. **Si tocás un workflow, exportalo de nuevo y commiteá el JSON.**

**Convención de naming**: `<dominio>-<accion>` en kebab-case. Ejemplos: `weekly-trigger-send`, `inbound-message-handle`.

---

## Inventario de workflows

| Slug | Tipo de trigger | Frecuencia | Responsabilidad |
|---|---|---|---|
| `weekly-trigger-send` | Cron | Jueves 10:00 | Disparar mensaje semanal a los activos |
| `weekly-reminder-send` | Cron | Viernes 12:00 | Recordatorio a los que no respondieron |
| `weekly-cycle-close` | Cron | Viernes 18:00 | Cerrar ciclo, marcar `no_report` |
| `weekly-process` | Cron | Viernes 19:00 | Consolidar y generar publicaciones |
| `weekly-delivery-send` | Cron | Lunes 08:00 | Enviar consolidado interno a los 27 |
| `inbound-message-handle` | Webhook | On-demand | Procesar cada mensaje entrante |
| `cycle-bootstrap` | Cron | Lunes 00:05 | Crear el `weekly_cycle` de la semana |
| `escalation-check` | Cron | Lunes 09:00 | Detectar usuarios con 2/3/4 semanas sin reportar |

---

## 1. `cycle-bootstrap`

**Trigger**: Cron `0 5 * * 1` (lunes 00:05 hora Argentina).

**Pasos**:
1. Calcular `year` e `iso_week` actual.
2. `POST /api/internal/cycles/ensure` (idempotente).
3. La app crea el `weekly_cycle` si no existe, con `status='pending'` y todos los horarios calculados.

**Error handling**: si la app responde 500, n8n reintenta hasta 3 veces con backoff. Si falla todo, envía mensaje de alerta a Julián.

---

## 2. `weekly-trigger-send`

**Trigger**: Cron `0 10 * * 4` (jueves 10:00).

**Pasos**:
1. `GET /api/internal/cycles/current` → toma el ciclo de esta semana.
2. Si `status != 'pending'`, abort (ya se disparó).
3. `POST /api/internal/cycles/:id/open` → cambia status a `open`.
4. `GET /api/internal/users/active-for-cycle/:cycleId` → lista de users que NO están de licencia esta semana.
5. Loop sobre la lista, con throttling de 2s entre mensajes para no saturar Evolution:
   - `POST /api/internal/messages/send` con `purpose=weekly_trigger` y el template del disparo.
6. Al terminar, log de cuántos se enviaron y a quiénes se excluyó.

**Mensaje del disparo** (template configurable en `system_settings`):
```
Hola [nombre], ¿cómo va tu semana?

Para el reporte semanal del Secretariado, contame en un audio o texto:
qué hiciste, en qué estuviste trabajando, y cualquier tema que valga
la pena que el resto sepa.

Si querés pasar esta semana, respondé "esta semana paso".
Si te tomás vacaciones, contame las fechas.

Tenés hasta el viernes a las 18 hs.
```

---

## 3. `inbound-message-handle`

**Trigger**: Webhook desde Evolution API en `/webhook/whatsapp-inbound`.

**Pasos**:
1. Recibe el payload crudo del provider.
2. `POST /api/internal/messages/inbound` con el payload.
3. La app:
   - Persiste en `inbound_messages`.
   - Resuelve `user_id` por `from_phone_e164`. Si no existe, marca `discarded_at` con razón "número no registrado" y abort.
   - Resuelve `cycle_id`: el ciclo `open` o el más reciente `closed` si llegó tarde.
   - Devuelve `{ id, kind, audioPath?, userId, cycleId }`.
4. Branch según `kind`:
   - **audio**: `POST http://transcriber:8000/transcribe { path }` → devuelve `{ text }` → `POST /api/internal/messages/:id/attach-transcription`.
   - **text**: skip transcription.
5. `POST /api/internal/ai/classify-intent` con el texto (o transcripción).
   - Devuelve uno de: `report`, `report_followup_reply`, `absence_request`, `weekly_pause`, `unknown`.
6. Branch según `intent`:

   **A) `absence_request`** → `POST /api/internal/absences/parse-and-create`. La app usa Haiku para extraer fechas, valida, crea fila en `absences`, confirma al usuario por WhatsApp.

   **B) `weekly_pause`** → `POST /api/internal/reports/mark-paused` para el ciclo activo. Confirma por WhatsApp.

   **C) `report` o `report_followup_reply`** → continúa al paso 7.

   **D) `unknown`** → mensaje a Julián con el contenido para revisar. Confirma al user con "Tu mensaje quedó registrado, lo vamos a revisar".

7. `POST /api/internal/ai/extract` con el texto, `user_id`, `cycle_id`. La app:
   - Llama a Haiku.
   - Mergea con el `report` existente del user/cycle (si hay) o crea uno nuevo.
   - Devuelve `{ reportId, needsFollowup: bool, followupReason?: string }`.
8. Si `needsFollowup == true` y `followup_count < MAX_FOLLOWUPS` (default 2):
   - `POST /api/internal/ai/followup-question` → devuelve `{ question }`.
   - `POST /api/internal/messages/send` con la pregunta.
   - Incrementa `followup_count` en el reporte.
9. Si está completo, mensaje de confirmación al user: "Gracias, lo registramos. Si querés sumar algo más, podés escribir hasta el viernes a las 18".

**Error handling**: cualquier fallo del transcriber o de Claude, n8n reintenta 2 veces. Si sigue fallando, manda mensaje al user "Hubo un problema procesando tu mensaje, lo revisamos manualmente" y alerta a Julián.

---

## 4. `weekly-reminder-send`

**Trigger**: Cron `0 12 * * 5` (viernes 12:00).

**Pasos**:
1. `GET /api/internal/cycles/current` → si `status != 'open'`, abort.
2. `GET /api/internal/cycles/:id/users-without-report` → users que esta semana no mandaron nada y no están en pausa/licencia.
3. Loop con throttling, enviar recordatorio:
   ```
   Hola [nombre], te recuerdo el reporte semanal. Tenés hasta hoy a las 18 hs.
   Si esta semana no podés, respondé "esta semana paso".
   ```

---

## 5. `weekly-cycle-close`

**Trigger**: Cron `0 18 * * 5` (viernes 18:00).

**Pasos**:
1. `POST /api/internal/cycles/current/close`. La app:
   - Cambia `status` a `closed`.
   - Por cada user activo sin reporte, sin pausa, sin licencia → crea `report` con `status='no_report'`.
   - Por cada user con licencia → crea `report` con `status='on_leave'`.
   - Por cada user con pausa semanal → ya tiene `report status='paused'`.
   - Por cada user con reporte en `awaiting_followup` → cambia a `complete` (corta la conversación, lo que haya queda).
2. Notifica a Julián por WhatsApp: "Ciclo de la semana X cerrado. Reportes: Y completos, Z pausas, W sin reporte. Procesamiento en 1 hora".

---

## 6. `weekly-process`

**Trigger**: Cron `0 19 * * 5` (viernes 19:00).

**Pasos**:
1. `GET /api/internal/cycles/current` → si `status != 'closed'`, abort con alerta.
2. `POST /api/internal/ai/consolidate { cycleId }`. La app:
   - Toma todos los reports `complete` del ciclo con sus items.
   - Llama a Sonnet con prompt de consolidación firmada.
   - Persiste en `consolidations` con `status='draft'`.
   - Devuelve `consolidationId`.
3. En paralelo (3 ramas):
   - `POST /api/internal/ai/draft-publication { cycleId, kind: 'social_instagram' }`
   - `POST /api/internal/ai/draft-publication { cycleId, kind: 'social_x' }`
   - `POST /api/internal/ai/draft-publication { cycleId, kind: 'newsletter' }`
4. Marca `weekly_cycles.processed_at = now()`, `status='processed'`.
5. `POST /api/internal/messages/send` a Julián:
   ```
   Sábado para revisión: el consolidado del [semana X] y 3 drafts están listos.
   Entrá a [panel.atepsa.org.ar/revision].
   ```

**Idempotencia**: si el workflow se corre dos veces (manual), la app detecta `consolidations` ya existente para ese `cycleId` y responde 409. Para re-procesar, hay endpoint manual `POST /api/internal/cycles/:id/reprocess` que crea nueva versión auditada.

---

## 7. `weekly-delivery-send`

**Trigger**: Cron `0 8 * * 1` (lunes 08:00).

**Pasos**:
1. `GET /api/internal/cycles/last-processed` → consolidación de la semana pasada.
2. Si `consolidations.status != 'approved'` → alerta a Julián "no aprobaste el consolidado, no lo envío". Abort.
3. `GET /api/internal/users/active` → los 27 (excluye solo dados de baja).
4. Por cada user, mensaje con `outbound_messages.purpose='consolidation_delivery'`:
   ```
   Buen lunes. Acá va lo que reportó el Secretariado la semana pasada:
   
   [resumen breve, 3-5 líneas]
   
   Versión completa: [panel.atepsa.org.ar/cycles/X]
   ```
5. Marca `consolidations.status='sent'`.

---

## 8. `escalation-check`

**Trigger**: Cron `0 9 * * 1` (lunes 09:00).

**Pasos**:
1. Para cada user activo con rol `secretary`:
   - Contar cuántos de los últimos 4 ciclos cerrados no tienen reporte `complete` ni `paused` ni `on_leave`.
2. Si son 2 ciclos consecutivos sin reportar:
   - `POST /api/internal/notifications/julian` con: "X no reportó las últimas 2 semanas. Considerá escribirle personalmente."
   - **No** envía nada automático al user. Es decisión humana de Julián.
3. Si son 3 ciclos:
   - Aparece en una sección del consolidado interno del lunes "Sin reporte recientemente: [lista]".
4. Si son 4+ ciclos (~mes):
   - `POST /api/internal/notifications/sec-general` notificando al Secretario General.

**Nota**: este workflow no manda mensajes automáticos al usuario rezagado. La política es sin perseguir. Las alertas son a Julián y al Sec. General.

---

## Workflows manuales / on-demand (sin cron)

Estos no tienen cron, se disparan desde el panel admin con un botón:

- `cycle-reprocess`: Julián puede pedir que se re-corra `weekly-process` para un ciclo (genera nueva versión de consolidación, los drafts viejos quedan archivados con `status='discarded'`).
- `user-send-custom`: Julián puede mandar un mensaje custom desde el panel a un user (queda en `outbound_messages` con `purpose='admin_message'`).
- `prompt-test-run`: probar un prompt editado contra un reporte real sin escribir a DB.

---

## Convenciones para los nodos de n8n

- **Cada workflow empieza con un nodo `Set` "context"** que define variables base (`baseUrl`, `internalApiKey`).
- **Las URLs internas usan hostname Docker** (`http://web:3000/api/internal/...`), no la URL pública.
- **Auth interno**: todos los `HTTP Request` agregan header `Authorization: Bearer {{$env.INTERNAL_API_SECRET}}`.
- **Error workflow**: cada workflow tiene un sub-workflow `error-handler` linkeado en "Error Workflow" que logea + alerta a Julián.
- **Nada de lógica de negocio en nodos `Code`**: si necesitás más de 5 líneas de JS, eso va a un endpoint de la app.
- **Sleep / wait**: si necesitás esperar (entre mensajes), usá `Wait` node, no JS.

---

## Versionado de workflows

```bash
# Después de editar en la UI de n8n:
# 1. Settings → Download → guarda JSON
# 2. mv ~/Downloads/<wf>.json n8n/workflows/<slug>.json
# 3. git add n8n/workflows/<slug>.json && git commit
```

En el futuro evaluamos n8n CLI o el endpoint `/api/v1/workflows` para automatizarlo.
