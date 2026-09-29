import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = await readFile(new URL('../assets/icon.svg', import.meta.url));
await sharp(source, { density: 192 }).resize(1024, 1024).png().toFile(fileURLToPath(new URL('../assets/icon.png', import.meta.url)));
process.stdout.write('Created assets/icon.png from assets/icon.svg\n');
