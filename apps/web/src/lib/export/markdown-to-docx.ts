import fs from 'fs';
import path from 'path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Header,
  ImageRun,
  HorizontalPositionRelativeFrom,
  VerticalPositionRelativeFrom,
  TextWrappingType,
  LevelFormat,
  convertInchesToTwip,
} from 'docx';

// Ruta al membrete institucional.
// En producción (Docker standalone): /app/public/template/membrete.jpg
// En desarrollo: apps/web/public/template/membrete.jpg
// process.cwd() apunta al WORKDIR de Next.js (/app en Docker, apps/web/ en dev local).
const MEMBRETE_PATH = path.join(process.cwd(), 'public', 'template', 'membrete.jpg');

// Dimensiones exactas de A4 en EMU (1 twip = 635 EMU)
// A4: 11906 twips × 16838 twips → 7560310 × 10692130 EMU
// Conversión a px @96 DPI: EMU * 96 / 914400
const MEMBRETE_WIDTH_PX = Math.round(11906 * 635 * 96 / 914400);  // ≈ 793
const MEMBRETE_HEIGHT_PX = Math.round(16838 * 635 * 96 / 914400); // ≈ 1121

// La imagen arranca en la esquina superior-izquierda exacta de la página (sin offset)
const MEMBRETE_H_OFFSET = 0;
const MEMBRETE_V_OFFSET = 0;

// Márgenes de página A4 (en twips, 1440 = 1 pulgada = 2.54cm)
// Top 4.5cm para quedar bien debajo de la banda de logos del membrete
const PAGE_MARGIN = {
  top: 2551,    // ≈ 4.5cm — debajo de la banda del logo
  right: 1440,  // 1 inch
  bottom: 1701, // ≈ 3cm — encima de la franja del pie
  left: 1440,   // 1 inch
};

// ─── Parser de runs inline ──────────────────────────────────────────────────

function parseInlineRuns(text: string): TextRun[] {
  // Separa **bold** y *italic* (el orden importa: primero bold)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/);
  return parts
    .filter(p => p.length > 0)
    .map(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return new TextRun({ text: part.slice(2, -2), bold: true, font: 'Bahnschrift' });
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return new TextRun({ text: part.slice(1, -1), italics: true, font: 'Bahnschrift' });
      }
      return new TextRun({ text: part, font: 'Bahnschrift' });
    });
}

// ─── Builder de párrafos ────────────────────────────────────────────────────

function buildParagraph(line: string): Paragraph | null {
  // H1: # Título
  if (line.startsWith('# ')) {
    return new Paragraph({
      children: [new TextRun({ text: line.slice(2), bold: true, size: 28, font: 'Bahnschrift' })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    });
  }

  // H2: ## Categoría
  if (line.startsWith('## ')) {
    return new Paragraph({
      children: [new TextRun({ text: line.slice(3), bold: true, size: 24, font: 'Bahnschrift' })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 80 },
    });
  }

  // H3: ### Subtítulo
  if (line.startsWith('### ')) {
    return new Paragraph({
      children: [new TextRun({ text: line.slice(4), bold: true, font: 'Bahnschrift' })],
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 160, after: 60 },
    });
  }

  // Sub-bullet (2 o 4 espacios)
  if (line.match(/^( {2,4}|\t)- /)) {
    const content = line.replace(/^[ \t]+-\s/, '');
    return new Paragraph({
      children: parseInlineRuns(content),
      numbering: { reference: 'bullets', level: 1 },
      spacing: { before: 20, after: 20 },
    });
  }

  // Bullet principal: - ítem
  if (line.startsWith('- ')) {
    return new Paragraph({
      children: parseInlineRuns(line.slice(2)),
      numbering: { reference: 'bullets', level: 0 },
      spacing: { before: 40, after: 40 },
    });
  }

  // Separador horizontal (---)
  if (/^-{3,}$/.test(line.trim())) return null;

  // Línea vacía → párrafo de espaciado
  if (line.trim() === '') {
    return new Paragraph({ children: [new TextRun('')], spacing: { before: 80 } });
  }

  // Párrafo normal (incluye líneas de métricas en cursiva del encabezado)
  return new Paragraph({
    children: parseInlineRuns(line),
    spacing: { before: 60, after: 60 },
    alignment: AlignmentType.JUSTIFIED,
  });
}

// ─── Función principal ──────────────────────────────────────────────────────

export async function markdownToDocx(
  markdown: string,
  title: string = 'ATEPSA',
): Promise<Buffer> {
  const lines = markdown.split('\n');

  const paragraphs: Paragraph[] = [];
  for (const line of lines) {
    const p = buildParagraph(line);
    if (p) paragraphs.push(p);
  }

  // Leer la imagen del membrete (si existe en el filesystem)
  let membreteBuffer: Buffer | null = null;
  try {
    membreteBuffer = fs.readFileSync(MEMBRETE_PATH);
  } catch {
    // En dev sin el template, generar sin membrete
  }

  const headerChildren: Paragraph[] = [];
  if (membreteBuffer) {
    headerChildren.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: 'jpg',
            data: membreteBuffer,
            transformation: {
              width: MEMBRETE_WIDTH_PX,
              height: MEMBRETE_HEIGHT_PX,
            },
            floating: {
              horizontalPosition: {
                relative: HorizontalPositionRelativeFrom.PAGE,
                offset: MEMBRETE_H_OFFSET,
              },
              verticalPosition: {
                relative: VerticalPositionRelativeFrom.PAGE,
                offset: MEMBRETE_V_OFFSET,
              },
              behindDocument: true,
              allowOverlap: true,
              wrap: { type: TextWrappingType.NONE },
              lockAnchor: false,
              layoutInCell: true,
            },
            altText: {
              title: 'Membrete ATEPSA',
              description: 'Membrete institucional ATEPSA',
              name: 'membrete',
            },
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    creator: 'ATEPSA — Sistema de Reportes',
    title,
    description: 'Consolidado semanal del Secretariado Nacional',
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
                run: { font: 'Bahnschrift' },
              },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: '–',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 1080, hanging: 360 } },
                run: { font: 'Bahnschrift' },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: {
            size: 22, // 11pt
            font: 'Bahnschrift',
          },
          paragraph: {
            spacing: { line: 276 }, // 1.15
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,  // A4 ancho en twips
              height: 16838, // A4 alto en twips
            },
            margin: PAGE_MARGIN,
          },
        },
        headers: {
          default: new Header({
            children: headerChildren.length > 0 ? headerChildren : [new Paragraph({ children: [] })],
          }),
        },
        children: paragraphs,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
