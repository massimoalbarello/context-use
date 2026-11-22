import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { normalizePath } from 'vite';

const require = createRequire(import.meta.url);
const reactPdf = createRequire(require.resolve('react-pdf/package.json'));
export const pdfjsDirectory = dirname(reactPdf.resolve('pdfjs-dist/package.json'));
export const pdfjsLegacyEntry = normalizePath(reactPdf.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
