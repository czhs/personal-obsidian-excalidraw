/** Local cover assets: curated, credited Unsplash presets and private uploaded copies. */
import { readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remoteCoverName } from "./unsplash.mjs";
const assets = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "assets/covers",
);
export const presets = JSON.parse(
  await readFile(path.join(assets, "credits.json"), "utf8"),
);
const uploadName = /^[a-f0-9-]{36}\.jpg$/;
export async function coverInfo(store, directory) {
  const value = store.covers[directory];
  if (!value) return null;
  if (remoteCoverName.test(value)) {
    try {
      const photo = JSON.parse(
        await readFile(path.join(store.userData, "covers", value), "utf8"),
      );
      const url = new URL(photo.src);
      if (url.protocol !== "https:" || url.hostname !== "images.unsplash.com")
        return null;
      return {
        id: value,
        src: photo.src,
        credit: `${photo.author} / Unsplash`,
        preset: value,
      };
    } catch {
      return null;
    }
  }
  const preset = presets.find((item) => item.id === value);
  const filename = preset
    ? path.join(assets, `${preset.id}.jpg`)
    : uploadName.test(value)
      ? path.join(store.userData, "covers", value)
      : null;
  if (!filename) return null;
  try {
    return {
      id: value,
      src: `data:image/jpeg;base64,${(await readFile(filename)).toString("base64")}`,
      credit: preset ? `${preset.author} / Unsplash` : "",
      preset: preset?.id ?? null,
    };
  } catch {
    return null;
  }
}
export async function setCover(store, directory, value) {
  const previous = store.covers[directory];
  if (value === null) delete store.covers[directory];
  else store.covers[directory] = value;
  try {
    await store.save();
  } catch (error) {
    if (previous) store.covers[directory] = previous;
    else delete store.covers[directory];
    throw error;
  }
  if (
    previous &&
    previous !== value &&
    (uploadName.test(previous) || remoteCoverName.test(previous)) &&
    !Object.values(store.covers).includes(previous)
  )
    await rm(path.join(store.userData, "covers", previous), {
      force: true,
    }).catch(() => {});
}
export async function uploadCover(store, directory, filename, nativeImage) {
  const info = await stat(filename);
  if (!info.isFile() || info.size > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB.");
  const image = await nativeImage.createThumbnailFromPath(filename, {
    width: 1200,
    height: 700,
  });
  if (image.isEmpty())
    throw new Error(
      "This image could not be read. Try a PNG, JPEG, or WebP image.",
    );
  const name = `${randomUUID()}.jpg`;
  const folder = path.join(store.userData, "covers");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, name), image.toJPEG(85));
  try {
    await setCover(store, directory, name);
  } catch (error) {
    await rm(path.join(folder, name), { force: true });
    throw error;
  }
}

export async function setUnsplashCover(store, directory, photo) {
  const name = `unsplash-${photo.id}.json`;
  if (!remoteCoverName.test(name)) throw new Error("Invalid photo.");
  const folder = path.join(store.userData, "covers");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, name), JSON.stringify(photo));
  await setCover(store, directory, name);
}
export async function coverCredit(store, id) {
  const preset = presets.find((item) => item.id === id);
  if (preset) return preset.url;
  if (!remoteCoverName.test(id) || !Object.values(store.covers).includes(id))
    throw new Error("Unknown cover.");
  const photo = JSON.parse(
    await readFile(path.join(store.userData, "covers", id), "utf8"),
  );
  const url = new URL(photo.creditURL);
  if (url.protocol !== "https:" || url.hostname !== "unsplash.com")
    throw new Error("Invalid photo credit.");
  return url.href;
}
