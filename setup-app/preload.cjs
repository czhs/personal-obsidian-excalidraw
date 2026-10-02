const { contextBridge, ipcRenderer } = require("electron");
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld("vaults", {
  unsplashStatus: () => invoke("unsplash:status"),
  unsplashConnect: (key) => invoke("unsplash:connect", key),
  unsplashDisconnect: () => invoke("unsplash:disconnect"),
  unsplashSearch: (query, page) => invoke("unsplash:search", query, page),
  unsplashSetup: () => invoke("unsplash:setup"),
  unsplashCredit: (id) => invoke("unsplash:credit", id),
  unsplashSelect: (path, id) => invoke("unsplash:select", path, id),
  presets: () => invoke("covers:presets"),
  cover: (path, id) => invoke("covers:set", path, id),
  uploadCover: (path) => invoke("covers:upload", path),
  credit: (id) => invoke("covers:credit", id),
  reload: (path) => invoke("vaults:reload", path),
  rename: (path, name) => invoke("vaults:rename", path, name),
  restore: (path) => invoke("vaults:restore", path),
  remove: (path) => invoke("vaults:remove", path),
  folder: (action, id, name) => invoke("vaults:folder", action, id, name),
  move: (path, id) => invoke("vaults:move", path, id),
  list: () => invoke("vaults:list"),
  choose: (kind) => invoke("vaults:choose", kind),
  install: (request) => invoke("vaults:install", request),
  open: (path) => invoke("vaults:open", path),
  reveal: (path) => invoke("vaults:reveal", path),
  backup: (path) => invoke("vaults:backup", path),
  blogStatus: () => invoke("blog:status"),
  blogChoose: () => invoke("blog:choose"),
  blogCreate: (request) => invoke("blog:create", request),
});
