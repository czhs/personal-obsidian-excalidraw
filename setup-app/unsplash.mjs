/** Official Unsplash API only. Credentials remain in the main process. */
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import path from "node:path";
export const remoteCoverName = /^unsplash-[A-Za-z0-9_-]{1,80}\.json$/;
const tagged = (value) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "unsplash.com")
    throw new Error("Invalid Unsplash link.");
  url.searchParams.set("utm_source", "excalidraw_vaults");
  url.searchParams.set("utm_medium", "referral");
  return url.href;
};
export function photoRecord(photo) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(photo.id))
    throw new Error("Invalid photo.");
  const image = new URL(photo.urls.regular);
  if (image.protocol !== "https:" || image.hostname !== "images.unsplash.com")
    throw new Error("Invalid photo image.");
  const download = new URL(photo.links.download_location);
  if (
    download.origin !== "https://api.unsplash.com" ||
    download.pathname !== `/photos/${photo.id}/download`
  )
    throw new Error("Invalid photo download.");
  image.searchParams.set("w", "1200");
  image.searchParams.set("q", "85");
  const thumb = new URL(image);
  thumb.searchParams.set("w", "480");
  return {
    id: photo.id,
    src: image.href,
    thumb: thumb.href,
    title: String(
      photo.alt_description || photo.description || "Unsplash photo",
    ).slice(0, 200),
    author: String(photo.user.name).slice(0, 100),
    creditURL: tagged(photo.user.links.html),
    photoURL: tagged(photo.links.html),
    download: download.href,
  };
}
export class UnsplashLibrary {
  constructor(userData, safeStorage, request = fetch) {
    this.filename = path.join(userData, "unsplash-key.enc");
    this.safeStorage = safeStorage;
    this.request = request;
    this.photos = new Map();
  }
  async key() {
    try {
      return this.safeStorage.decryptString(await readFile(this.filename));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error("Reconnect Unsplash to unlock your saved access key.");
    }
  }
  async status() {
    return { connected: Boolean(await this.key()) };
  }
  async api(endpoint, key) {
    if (!key) throw new Error("Connect Unsplash to search its photo library.");
    const url = new URL(endpoint, "https://api.unsplash.com");
    if (url.origin !== "https://api.unsplash.com")
      throw new Error("Invalid Unsplash request.");
    let response;
    try {
      response = await this.request(url, {
        headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        "Cannot reach Unsplash. Check your connection and try again.",
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new Error(
        "Unsplash rejected this access key. Check the key and app permissions.",
      );
    if (response.status === 429)
      throw new Error("Unsplash’s request limit was reached. Try again later.");
    if (!response.ok)
      throw new Error("Unsplash is unavailable right now. Try again shortly.");
    return response.json();
  }
  async connect(key) {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(key.trim()))
      throw new Error("Paste the Access Key from your Unsplash application.");
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error(
        "macOS secure storage is unavailable. Try reopening the app.",
      );
    key = key.trim();
    await this.api("/photos?per_page=1", key);
    await mkdir(path.dirname(this.filename), { recursive: true });
    await writeFile(
      this.filename + ".tmp",
      this.safeStorage.encryptString(key),
      { mode: 0o600 },
    );
    await rename(this.filename + ".tmp", this.filename);
    this.photos.clear();
  }
  async disconnect() {
    await rm(this.filename, { force: true });
    this.photos.clear();
  }
  async search(query, page = 1) {
    if (
      typeof query !== "string" ||
      query.length > 100 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100
    )
      throw new Error("Enter a shorter search.");
    const params = new URLSearchParams({
      page: String(page),
      per_page: "24",
      orientation: "landscape",
      content_filter: "high",
      query: query.trim() || "nature",
    });
    const result = await this.api(`/search/photos?${params}`, await this.key());
    const photos = result.results.map(photoRecord);
    for (const photo of photos) this.photos.set(photo.id, photo);
    while (this.photos.size > 1000)
      this.photos.delete(this.photos.keys().next().value);
    return { photos, hasMore: page < Math.min(result.total_pages, 100) };
  }
  async select(id) {
    const photo = this.photos.get(id);
    if (!photo) throw new Error("Search again to select this photo.");
    // A cover selection is a download under Unsplash's API guidelines.
    await this.api(photo.download, await this.key());
    return photo;
  }
  credit(id) {
    const photo = this.photos.get(id);
    if (!photo) throw new Error("Search again to view this credit.");
    return photo.creditURL;
  }
}
