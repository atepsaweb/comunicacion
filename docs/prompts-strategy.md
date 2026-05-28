# Estrategia de prompts y modelos de Claude

## Principios

1. **Modelo más barato que sirva**. Empezamos con Haiku 4.5, escalamos a Sonnet 4.6 solo donde la calidad importa al ojo humano.
2. **Prompt caching siempre**. El system prompt + few-shot examples van marcados como cacheable. Ahorra ~70% en costo de input cuando se reutiliza.
3. **Salida estructurada (JSON) donde se procesa por código**. Texto natural solo para outputs que un humano va a leer/editar.
4. **Versionado**: cada prompt vive en `apps/web/src/lib/ai/prompts/<slug>.ts` con su versión inicial. La copia activa en runtime se lee de la tabla `prompts` (editable desde el panel).
5. **Sin PII en prompts si se puede evitar**. Los reportes incluyen nombres de afiliados y temas sensibles, pero eso es inevitable para el caso de uso. Anonimización opcional configurable a futuro.
6. **Idioma**: español rioplatense. System prompt define la voz de ATEPSA (técnica, firme, no panfletaria).

---

## Modelos disponibles

| Modelo | Precio input | Precio output | Uso |
|---|---|---|---|
| `claude-haiku-4-5-20251001` | USD 1/MTok | USD 5/MTok | Extracción, clasificación, repreguntas |
| `claude-sonnet-4-6` | USD 3/MTok | USD 15/MTok | Consolidación, drafts de publicaciones |

Con cache hit: input cacheado a ~10% del precio original.

---

## Mapa de tareas

| Slug | Modelo | Razón |
|---|---|---|
| `classify-intent` | Haiku | Clasificación simple (5 categorías). Sobra. |
| `extract-report` | Haiku | Extracción estructurada de items. Tarea acotada, schema claro. |
| `assess-completeness` | Haiku | Decide si el reporte necesita repregunta. Booleano + razón. |
| `followup-question` | Haiku | Generar 1 pregunta corta. No requiere creatividad. |
| `parse-absence` | Haiku | Parsear "vacaciones del 15 al 30 de enero" → fechas. |
| `consolidate-internal` | Sonnet | Síntesis con tono editorial firmado. Calidad importa. |
| `draft-social-instagram` | Sonnet | Pieza pública con voz ATEPSA. Calidad importa. |
| `draft-social-x` | Sonnet | Pieza pública, formato limitado. Calidad importa. |
| `draft-newsletter` | Sonnet | Pieza larga, más editorial. Calidad importa. |

---

## Estimación de costo mensual

Asunciones (caso realista, 4 semanas de operación):

| Tarea | Llamadas/sem | Tokens in/llamada | Tokens out/llamada | Modelo |
|---|---|---|---|---|
| classify-intent | ~50 | 800 | 50 | Haiku |
| extract-report | ~35 | 1500 | 600 | Haiku |
| assess-completeness | ~35 | 600 | 100 | Haiku |
| followup-question | ~15 | 1000 | 100 | Haiku |
| parse-absence | ~3 | 400 | 80 | Haiku |
| consolidate-internal | 1 | 8000 | 3000 | Sonnet |
| draft-social-instagram | 1 | 5000 | 800 | Sonnet |
| draft-social-x | 1 | 5000 | 300 | Sonnet |
| draft-newsletter | 1 | 5000 | 1500 | Sonnet |

**Costos semanales aproximados** (sin cache):
- Haiku: ~(50·800 + 35·1500 + 35·600 + 15·1000 + 3·400) inputs ≈ 130k tokens · USD 1/MTok = USD 0.13 + outputs ~USD 0.18 → **~USD 0.31/sem**
- Sonnet: (8k + 5k + 5k + 5k) input = 23k · USD 3/MTok = USD 0.069 + (3k + 0.8k + 0.3k + 1.5k) output = 5.6k · USD 15/MTok = USD 0.084 → **~USD 0.15/sem**

**Total mensual estimado: USD 1.84/mes** sin cache, **~USD 0.80/mes** con cache activo.

Hay margen para experimentar con Sonnet en más tareas si la calidad lo amerita. Incluso usando Sonnet para todo: ~USD 8-12/mes. Muy lejos de cualquier preocupación de presupuesto.

---

## Prompts (descripción de cada uno)

### `classify-intent`

**Input**: texto del mensaje del usuario (post-transcripción si era audio).
**Output**: JSON `{ intent: 'report' | 'report_followup_reply' | 'absence_request' | 'weekly_pause' | 'unknown', confidence: 0-1 }`.

**System prompt resumido**:
> Sos un clasificador de mensajes para un sistema de reporte semanal de un sindicato. Clasificá el mensaje en una de las 5 categorías. Si el mensaje habla de actividades, gestiones o trabajo de la semana → `report`. Si pide tomarse vacaciones o licencia → `absence_request`. Si dice algo como "esta semana paso", "no puedo esta semana" → `weekly_pause`. Si responde a una pregunta previa del bot → `report_followup_reply`. Si no se entiende → `unknown`. Devolvé solo JSON.

---

### `extract-report`

**Input**: 
- Texto del mensaje nuevo del usuario.
- Reporte parcial existente (si hay mensajes previos en el ciclo).
- Lista de categorías válidas (de `system_settings`).

**Output**: JSON con array de `items` (title, description, category, mentions, priority, is_public_safe), `completeness_score`, `merge_strategy` (cómo combinar con lo previo).

**System prompt resumido**:
> Sos un asistente que estructura reportes semanales del Secretariado de ATEPSA. ATEPSA es el sindicato de los trabajadores de navegación aérea de Argentina. Recibís lo que un secretario reportó por WhatsApp (puede ser transcripción de audio, puede tener errores de transcripción). Tu tarea es identificar los **temas** que reportó, cada uno con título, descripción, categoría, menciones (organismos, personas, lugares), prioridad estimada y si es publicable afuera. 
> 
> Importante: si menciona conflictos internos del sindicato, nombres de afiliados puntuales, o información sensible, marcá `is_public_safe: false`. 
>
> Vocabulario que vas a ver: EANA, ANAC, JST, ATC, AIS, MET, COM, paritaria, JUNTA, asamblea, plenario, secretariado, recategorización, etc. Está en el glosario adjunto.
>
> Si el reporte es muy escueto (menos de 2 ítems o todos vagos), marcá `completeness_score < 0.5`. Si está completo, `>= 0.7`.

**Few-shot examples**: incluir 3 ejemplos curados (uno completo, uno escueto, uno con tema sensible).

---

### `assess-completeness`

**Input**: el `report` ya extraído (con sus items).
**Output**: JSON `{ needs_followup: boolean, reason: string, suggested_question_topic: string }`.

**System prompt resumido**:
> Mirá este reporte semanal del Secretariado. Decidí si vale la pena repreguntar al autor para completar info crítica que falta. Sé deferente: si el secretario reportó razonablemente, no insistas. Repreguntá solo si:
> - Hay un ítem con título sin descripción real.
> - Mencionó algo importante (reunión, decisión, conflicto) sin contexto mínimo.
> - El reporte total tiene < 2 ítems.
>
> Si vale repreguntar, sugerí el tópico (no la pregunta exacta).

---

### `followup-question`

**Input**: el `report`, el `topic` sugerido por `assess-completeness`.
**Output**: texto plano, una pregunta corta y amable, máximo 2 oraciones.

**System prompt resumido**:
> Generá una pregunta para mandar por WhatsApp a un secretario que dejó un reporte incompleto. Tono: respetuoso, sintético, no escolar. Una pregunta sola, no múltiples. Si tiene que ver con [topic], enfocá ahí. Ejemplo de tono: "Che, mencionaste la reunión con EANA pero no contaste cómo salió. ¿Algo para sumar?"

---

### `parse-absence`

**Input**: texto del usuario, fecha actual.
**Output**: JSON `{ type: 'scheduled_leave' | 'weekly_pause', starts_on, ends_on, reason }`.

**System prompt resumido**:
> Parseá esta solicitud de licencia/pausa. Si dice "esta semana paso" → weekly_pause con starts/ends del ciclo actual. Si menciona fechas explícitas → scheduled_leave. Asumí año actual si no se especifica. Si las fechas son ambiguas, devolvé `null` y un mensaje pidiendo aclaración.

---

### `consolidate-internal`

**Input**:
- Lista completa de `reports` del ciclo con sus items.
- Métricas (cuántos reportaron, cuántos en licencia, cuántos pausa, cuántos sin reporte).
- Identidad: voz ATEPSA, instrucciones de estilo.

**Output**: Markdown estructurado:
- Encabezado con número de ciclo, fecha, métricas.
- Secciones por categoría con sub-ítems firmados (`- *(Pérez, J.)*` al final).
- Cierre con "Sin reporte esta semana: ..." si aplica.

**System prompt** (extenso):
> Sos editor del consolidado semanal interno del Secretariado Nacional de ATEPSA. Tu salida la lee solo el Secretariado (27 personas), no afiliados ni público general.
> 
> Tono: profesional, ágil, sin floreos. Lenguaje sindical técnico cuando corresponde. Sin signos de exclamación. Sin emojis. Sin clichés tipo "una semana intensa".
> 
> Estructura obligatoria:
> 1. Encabezado: `# Semana [N] · [rango fechas]` + línea de métricas en cursiva.
> 2. Secciones por categoría (solo las que tienen contenido). Cada ítem es un párrafo o bullet, firmado al final con el apellido del autor.
> 3. Cierre: "Sin reporte esta semana" si hay, con apellidos.
> 
> Cuando varios reportaron sobre el mismo tema, unificalos en un solo ítem listando los contribuyentes.
> 
> No inventes datos. Si algo no está en los reportes, no lo agregues.

---

### `draft-social-instagram`

**Input**: el `consolidations.internal_summary_md`, lista de items con `is_public_safe=true`, fecha.
**Output**: JSON con `{ caption, suggested_hashtags, suggested_visual_idea, character_count }`.

**System prompt**:
> Generá una pieza para Instagram (feed) de ATEPSA basada en el consolidado semanal. Audiencia: afiliados + público interesado en aviación argentina.
> 
> Voz: ATEPSA es un sindicato técnico-aeronáutico, no panfletario. Lenguaje firme, profesional. Cero "compañeros y compañeras" si no aporta. Cero "luchamos por". Sí hechos concretos: qué se hizo, qué se logró, qué viene.
> 
> Caption: 1500 caracteres máximo, 4-6 párrafos cortos, primer renglón es gancho. Hashtags al final, máximo 8, relevantes (no #amor #vida).
> 
> Solo usá items con `is_public_safe=true`. Si después del filtro hay poco contenido, hacé un caption breve sobre 1-2 temas.
> 
> Sugerí una idea visual (qué foto/gráfico iría) en una oración.

---

### `draft-social-x`

Similar a Instagram pero adaptado: máximo 280 caracteres por tweet, posibilidad de hilo de 2-3 tweets.

---

### `draft-newsletter`

**Input**: similar a Instagram.
**Output**: Markdown más extenso, con título, copete, 3-5 secciones, cierre.

**System prompt**:
> Newsletter mensual o semanal de ATEPSA hacia afiliados. Más extenso y editorial que las redes. Tono institucional. Estructura: título, copete (1-2 oraciones), 3-5 secciones por tema, cierre con próximos pasos o llamado a participar (sin caer en consigna). 600-1000 palabras.

---

## Prompt caching

Estructura recomendada de cada llamada:

```typescript
const messages = [
  {
    role: 'system',
    content: [
      { type: 'text', text: SYSTEM_PROMPT_BASE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: FEW_SHOT_EXAMPLES, cache_control: { type: 'ephemeral' } },
    ],
  },
  { role: 'user', content: USER_PROMPT },
];
```

El system prompt + ejemplos son grandes (~3-5k tokens) y se reutilizan. Cache hit ahorra ~90% de input cost.

---

## Iteración

Después de 4 semanas de uso real:
1. Revisar muestras de outputs reales (`ai_invocations`).
2. Identificar dónde Haiku se queda corto → escalar a Sonnet para ese slug.
3. Identificar dónde Sonnet está sobreequipado → bajar a Haiku.
4. Ajustar prompts según patrones de errores observados.

Esto se documenta en `docs/decisiones.md` como ADRs nuevos.
