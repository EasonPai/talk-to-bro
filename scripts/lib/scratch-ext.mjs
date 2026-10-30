// Live harnesses load the built extension from a git-ignored scratch dir so spikes/ is never written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SCRATCH_EXT_DIR = path.resolve(ROOT_DIR, '../../.scratch/talk-to-bro-personally/cft-ext');

export function syncDistToScratch(distDir) {
  // Keep the directory itself: Chrome disables an unpacked extension whose directory disappears.
  fs.mkdirSync(SCRATCH_EXT_DIR, { recursive: true });
  const keep = new Set(fs.readdirSync(distDir));
  for (const entry of fs.readdirSync(SCRATCH_EXT_DIR)) {
    if (!keep.has(entry)) fs.rmSync(path.join(SCRATCH_EXT_DIR, entry), { recursive: true, force: true });
  }
  fs.cpSync(distDir, SCRATCH_EXT_DIR, { recursive: true });
}
