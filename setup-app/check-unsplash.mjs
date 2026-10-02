import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnsplashLibrary, photoRecord } from "./unsplash.mjs";
import {
  setUnsplashCover,
  coverInfo,
  coverCredit,
  setCover,
} from "./covers.mjs";
const root = await mkdtemp(path.join(os.tmpdir(), "unsplash-check-"));
const photo = {
  id: "photo_123",
  alt_description: "Mountains",
  urls: { regular: "https://images.unsplash.com/photo-test?ixid=keep-me" },
  user: {
    name: "Photographer",
    links: { html: "https://unsplash.com/@artist" },
  },
  links: {
    html: "https://unsplash.com/photos/photo_123",
    download_location:
      "https://api.unsplash.com/photos/photo_123/download?ixid=keep-me",
  },
};
const calls = [];
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (key) => Buffer.from(key.split("").reverse().join("")),
  decryptString: (buffer) => buffer.toString().split("").reverse().join(""),
};
let status = 200;
const request = async (url, options) => {
  calls.push({ url: String(url), options });
  return {
    ok: status === 200,
    status,
    json: async () =>
      url.pathname === "/search/photos"
        ? { results: [photo], total_pages: 2 }
        : {},
  };
};
try {
  const library = new UnsplashLibrary(root, safe, request);
  assert.deepEqual(await library.status(), { connected: false });
  await assert.rejects(library.search("nature"), /Connect/);
  await library.connect("personal_test_access_key_12345");
  assert(
    !(await readFile(path.join(root, "unsplash-key.enc"), "utf8")).includes(
      "personal_test_access",
    ),
  );
  const reopened = new UnsplashLibrary(root, safe, request);
  assert.deepEqual(await reopened.status(), { connected: true });
  await reopened.search("nature");
  const result = await library.search("mountains & sea", 1);
  assert(result.hasMore);
  assert.equal(result.photos.length, 1);
  assert.equal(
    new URL(calls.at(-1).url).searchParams.get("query"),
    "mountains & sea",
  );
  assert.equal(
    new URL(result.photos[0].src).searchParams.get("ixid"),
    "keep-me",
  );
  await assert.rejects(library.select("unknown"), /Search again/);
  const selected = await library.select(photo.id);
  assert.equal(
    new URL(calls.at(-1).url).pathname,
    "/photos/photo_123/download",
  );
  const store = { userData: root, covers: {}, save: async () => {} };
  await setUnsplashCover(store, "vault-a", selected);
  const info = await coverInfo(store, "vault-a");
  assert.equal(info.credit, "Photographer / Unsplash");
  assert.equal(
    new URL(await coverCredit(store, info.id)).hostname,
    "unsplash.com",
  );
  store.covers["vault-b"] = store.covers["vault-a"];
  await setCover(store, "vault-a", null);
  assert(await coverInfo(store, "vault-b"));
  await setCover(store, "vault-b", null);
  await assert.rejects(readFile(path.join(root, "covers", info.id)), {
    code: "ENOENT",
  });
  assert.throws(() =>
    photoRecord({ ...photo, urls: { regular: "https://evil.example/image" } }),
  );
  status = 429;
  await assert.rejects(library.search("nature"), /limit/);
  status = 401;
  await assert.rejects(
    library.connect("invalid_personal_key_123456"),
    /rejected/,
  );
  assert.deepEqual(await library.status(), { connected: true });
  await library.disconnect();
  assert.deepEqual(await library.status(), { connected: false });
  console.log(
    "Unsplash checks passed: key handling, URL validation, search, tracking, cover persistence and cleanup, errors.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
