import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  convertInchesToTwip,
} from 'docx';

// Convierte un fragmento de texto con marcadores *...* y **...** a TextRuns de docx.
function parseInlineRuns(text: string): TextRun[] {
  // Separa por **bold** y *italic* (orden importa: primero bold)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/);
  return parts
    .filter(p => p.length > 0)
    .map(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return new TextRun({ text: part.slice(2, -2), bold: true });
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return new TextRun({ text: part.slice(1, -1), italics: true });
      }
      return new TextRun({ text: part });
    });
}

function buildParagraph(line: string): Paragraph | null {
  // H1
  if (line.startsWith('# ')) {
    return new Paragraph({
      children: [new TextRun({ text: line.slice(2), bold: true, size: 28 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    });
  }

  // H2
  if (line.startsWith('## ')) {
    return new Paragraph({
      children: [new TextRun({ text: line.slice(3), bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 80 },
    });
  }

  // H3
  if (line.startsWith('### ')) {
    return new Paragraph({
      children: [new TextRun({ text: line.slice(4), bold: true })],
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 160, after: 60 },
    });
  }

  // Bullet
  if (line.startsWith('- ')) {
    return new Paragraph({
      children: parseInlineRuns(line.slice(2)),
      bullet: { level: 0 },
      spacing: { before: 40, after: 40 },
    });
  }

  // Sub-bullet
  if (line.startsWith('  - ') || line.startsWith('    - ')) {
    const indent = line.startsWith('    - ') ? 1 : 1;
    const content = line.replace(/^\s+- /, '');
    return new Paragraph({
      children: parseInlineRuns(content),
      bullet: { level: indent },
      spacing: { before: 20, after: 20 },
    });
  }

  // Línea vacía → párrafo vacío pequeño
  if (line.trim() === '') {
    return new Paragraph({ children: [new TextRun('')], spacing: { before: 60 } });
  }

  // Línea horizontal (---)
  if (/^-{3,}$/.test(line.trim())) {
    return null; // omitir separadores horizontales del markdown
  }

  // Párrafo normal
  return new Paragraph({
    children: parseInlineRuns(line),
    spacing: { before: 60, after: 60 },
    alignment: AlignmentType.JUSTIFIED,
  });
}

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

  const doc = new Document({
    creator: 'ATEPSA — Sistema de Reportes',
    title,
    description: 'Consolidado semanal del Secretariado Nacional',
    styles: {
      default: {
        document: {
          run: {
            size: 22, // 11pt
            font: 'Calibri',
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
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.2),
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
