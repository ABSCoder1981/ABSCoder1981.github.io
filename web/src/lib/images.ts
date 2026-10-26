import type { ImageMetadata } from 'astro';

// Every image under src/assets/images, keyed by its path relative to that folder
// (e.g. "team/prashant.jpg"), so JSON content can reference images by name.
const modules = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/images/**/*.{png,jpg,jpeg,webp}',
  { eager: true },
);

const byKey = new Map<string, ImageMetadata>();
for (const [path, mod] of Object.entries(modules)) {
  byKey.set(path.replace('../assets/images/', ''), mod.default);
}

export function img(key: string): ImageMetadata {
  const found = byKey.get(key);
  if (!found) throw new Error(`Image not found in src/assets/images: ${key}`);
  return found;
}
