# Glosario sindical y aeronáutico

Este archivo **lo completás vos, Julián**. La IA va a usarlo como contexto para entender lo que reportan los secretarios. Cuanto más rico, mejores extracciones.

**Formato**: cada entrada en una línea: `**SIGLA / palabra** — definición corta (1-2 líneas)`.

**Convención**: agrupado por dominio. Si una sigla puede leerse mal por la IA (porque tiene varios significados), aclarar el contexto en el que aparece.

---

## Organismos y empresas

- **EANA** — Empresa Argentina de Navegación Aérea. Empleadora principal de los afiliados a ATEPSA.
- **ANAC** — Administración Nacional de Aviación Civil. Autoridad aeronáutica.
- **JST** — Junta de Seguridad en el Transporte. Investiga incidentes y accidentes.
- **ORSNA** — Organismo Regulador del Sistema Nacional de Aeropuertos.
- *(completar: SAR, INVAP relacionados, AA2000, etc.)*

---

## Especialidades / áreas de trabajo

- **ATC** — Air Traffic Controller / control de tránsito aéreo.
- **AIS** — Aeronautical Information Services.
- **MET** — Meteorología aeronáutica.
- **COM** — Comunicaciones.
- **NAV** — Navegación.
- **CNS** — Communication, Navigation, Surveillance (CNS/ATM).
- *(completar con todas las que se usan internamente)*

---

## Términos sindicales argentinos

- **paritaria** — negociación colectiva salarial.
- **plenario** — reunión amplia de delegados o secretariado.
- **asamblea** — reunión de afiliados con poder de decisión.
- **comisión revisora de cuentas** — órgano de control interno del sindicato.
- **secretariado nacional** — órgano ejecutivo del sindicato (los 27).
- **mesa ejecutiva** — núcleo del secretariado (Sec. General + adjuntos).
- **encuadramiento** — definición de quiénes son representados por el gremio.
- **recategorización** — cambio de categoría laboral con impacto salarial.
- *(completar con jerga propia de ATEPSA)*

---

## Lugares clave

- **Sede ATEPSA** — *(dirección)*
- **CIPE** — *(si aplica)*
- *(centros operativos relevantes: torres de control, ARO/AIS, etc.)*

---

## Personas (cargos, no nombres)

- **Secretario General** — *(definir si querés que aparezca el nombre o solo el cargo en los reportes)*
- *(presidentes de EANA, ANAC, etc. que se nombran seguido)*

---

## Documentos / instrumentos

- **CCT** — Convenio Colectivo de Trabajo (especificar número si aplica: ej. CCT 1217/12 E).
- **Acta paritaria** — documento de cierre de negociación.
- **Acuerdo marco** — convenios más amplios.
- *(completar)*

---

## Eventos recurrentes

- **Reunión semanal del Secretariado** — *(día, modalidad)*
- **Plenarios regionales** — *(periodicidad, regiones)*
- *(otros eventos: capacitaciones, congresos, asambleas anuales)*

---

## Cómo se usa este glosario

El system prompt de `extract-report` referencia este archivo. La sección **Organismos**, **Especialidades** y **Términos sindicales** se inyecta tal cual como contexto. La IA usa esto para:

1. **Reconocer siglas**: si el reporte dice "MET", saber que es Meteorología y no otra cosa.
2. **Categorizar correctamente**: si menciona "paritaria", la categoría es `negociacion_paritaria`.
3. **Identificar menciones**: extraer nombres de organismos al campo `mentions` del item.

**Mantenerlo vivo**: cada vez que aparezca jerga nueva o se corrija una mala interpretación, agregarla acá.
