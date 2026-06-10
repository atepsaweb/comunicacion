/**
 * Genera los íconos PWA desde public/icon-source.jpg (o .png).
 * Crea todos los tamaños necesarios para que la app pueda instalarse como PWA
 * en Android (íconos de 192px y 512px) y en iOS (apple-touch-icon de 180px).
 * También genera el ícono "maskable" con padding para la zona segura de Android.
 *
 * Uso: pnpm generate-icons
 * Requiere: sharp (devDependency)
 */
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const OUT = join(PUBLIC, 'icons');

const SOURCE_CANDIDATES = [
  join(PUBLIC, 'icon-source.jpg'),
  join(PUBLIC, 'icon-source.png'),
  join(PUBLIC, 'icon-source.jpeg'),
];

const source = SOURCE_CANDIDATES.find(f => existsSync(f));
if (!source) {
  console.error('Error: no se encontró la imagen fuente.');
  console.error('Guardá la imagen como apps/web/public/icon-source.jpg y volvé a ejecutar.');
  process.exit(1);
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const icons = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

// La maskable necesita padding del 10% para la safe zone de Android
const MASKABLE_SIZE = 512;
const PADDING = Math.round(MASKABLE_SIZE * 0.1);
const INNER = MASKABLE_SIZE - PADDING * 2;

for (const { name, size } of icons) {
  await sharp(source)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(join(OUT, name));
  console.log(`✓ ${name}`);
}

// Maskable: ícono con fondo sólido navy + logo centrado con padding
await sharp({
  create: {
    width: MASKABLE_SIZE,
    height: MASKABLE_SIZE,
    channels: 3,
    background: { r: 13, g: 32, b: 64 }, // #0d2040
  },
})
  .composite([{
    input: await sharp(source).resize(INNER, INNER, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
    top: PADDING,
    left: PADDING,
  }])
  .png()
  .toFile(join(OUT, 'icon-maskable-512.png'));

console.log('✓ icon-maskable-512.png');
console.log('\nÍconos generados en public/icons/ — podés hacer commit y deploy.');
