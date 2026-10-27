import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicRoot = join(root, 'public', 'ocr');
const destination = async (...parts) => join(publicRoot, ...parts);
const packageRoot = name => dirname(require.resolve(`${name}/package.json`));
const copy = async (source, ...target) => {
  const output = await destination(...target);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(source, output);
};

const tessRoot = packageRoot('tesseract.js');
const coreRoot = packageRoot('tesseract.js-core');
const pdfRoot = packageRoot('pdfjs-dist');
const langRoot = packageRoot('@tesseract.js-data/eng');

await copy(join(tessRoot, 'dist', 'worker.min.js'), 'tesseract-worker.min.js');
await copy(join(tessRoot, 'dist', 'worker.min.js.LICENSE.txt'), 'tesseract-worker.min.js.LICENSE.txt');
await copy(join(coreRoot, 'tesseract-core.wasm.js'), 'tesseract-core.wasm.js');
await copy(join(pdfRoot, 'build', 'pdf.worker.min.mjs'), 'pdf.worker.min.mjs');
await copy(join(langRoot, '4.0.0_best_int', 'eng.traineddata.gz'), 'lang', '4.0.0_best_int', 'eng.traineddata.gz');
await copy(join(tessRoot, 'LICENSE.md'), 'licenses', 'tesseract.js-LICENSE.md');
await copy(join(coreRoot, 'LICENSE'), 'licenses', 'tesseract.js-core-LICENSE');
await copy(join(pdfRoot, 'LICENSE'), 'licenses', 'pdfjs-dist-LICENSE');
await copy(join(coreRoot, 'LICENSE'), 'licenses', 'tessdata-LICENSE');

const engPackage = JSON.parse(await readFile(join(langRoot, 'package.json'), 'utf8'));
const notices = `Local OCR runtime notices\n\n` +
  `Sprout Track source is distributed under the accompanying Sprout Track License.\n` +
  `Tesseract.js ${JSON.parse(await readFile(join(tessRoot, 'package.json'), 'utf8')).version}: Apache-2.0 (license included).\n` +
  `Tesseract.js-core ${JSON.parse(await readFile(join(coreRoot, 'package.json'), 'utf8')).version}: Apache-2.0 (license included).\n` +
  `English traineddata from naptha/tessdata (${engPackage.version}); the trained data is Apache-2.0 (license included). The npm package wrapper is MIT-licensed.\n` +
  `PDF.js (${JSON.parse(await readFile(join(pdfRoot, 'package.json'), 'utf8')).version}): Apache-2.0 (license included).\n`;
await writeFile(await destination('THIRD-PARTY-NOTICES.txt'), notices, 'utf8');
