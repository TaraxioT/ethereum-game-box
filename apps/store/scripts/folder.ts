// A game's folder as a bundle's files. The packer judges the names, so a stray file fails there, with its reason.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Every file under `folder`, by its `/`-separated path inside it. A link isn't followed: it could reach anything. */
export async function readFolder(folder: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const at = path.join(entry.parentPath, entry.name);
    const name = path.relative(folder, at).split(path.sep).join('/');
    if (!entry.isFile()) throw new Error(`${name} isn't a plain file`);
    files.set(name, await readFile(at));
  }
  return files;
}
