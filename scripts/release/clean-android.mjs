import { lstatSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Only generated project outputs; never remove the Android project or its keys.
const outputs = [
  'android/build',
  'android/app/build',
  'android/.cxx',
  'android/app/.cxx',
  'modules/local-video-proxy/android/build',
  'modules/local-video-proxy/android/.cxx',
];

export function cleanAndroid(app) {
  const root = resolve(app);
  // Check all parents before deleting anything. A linked build directory itself
  // can be unlinked safely, but a linked parent could point outside the project.
  for (const output of outputs) {
    let parent = dirname(join(root, output));
    while (parent !== root) {
      if (lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`Nettoyage refusé : dossier parent lié (${parent}).`);
      }
      parent = dirname(parent);
    }
  }
  const removed = [];
  for (const output of outputs) {
    const target = join(root, output);
    if (!lstatSync(target, { throwIfNoEntry: false })) continue;
    rmSync(target, { recursive: true, force: true });
    removed.push(output);
  }
  return removed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = fileURLToPath(new URL('../../apps/HorusRemote/', import.meta.url));
  const removed = cleanAndroid(app);
  console.log(removed.length
    ? `Nettoyage Android terminé :\n${removed.map(path => `- ${path}`).join('\n')}`
    : 'Aucune sortie de compilation Android à nettoyer.');
}
