import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const dashboardRoot = fileURLToPath(new URL('../', import.meta.url));
export const publishedFiles = Object.freeze([
  'index.html',
  'theme.css',
  'app.js',
  'art.js',
  'motion.js',
  'assets/brand-mark.svg',
  'assets/vendor/gsap.min.js',
  'assets/fonts/oxanium-latin-variable.woff2',
  'assets/fonts/syncopate-latin-700.woff2',
  'assets/fonts/jetbrains-mono-latin-400.woff2',
  'assets/fonts/LICENSE-Oxanium.txt',
  'assets/fonts/LICENSE-Syncopate.txt',
  'assets/fonts/LICENSE-JetBrains-Mono.txt',
]);

export async function buildDashboard({ root = dashboardRoot, output = join(root, 'dist') } = {}) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const relative of publishedFiles) {
    const destination = join(output, relative);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, relative), destination);
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDashboard();
  console.log('Built apps/dashboard/dist — static assets, with no external runtime requests.');
}
