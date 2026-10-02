import { createCoverBrowser } from "./cover-browser.js";
const $ = (selector) => document.querySelector(selector);
let data = { vaults: [], archived: [], folders: [], version: "" };
let folderFilter = null;
let editingVault = null;
let editingFolder = null;
let coverVault = null;
let presets = null;
let filter = "all";
let working = false;
let parent = null;
let toastTimer;
const labels = {
  archived: "Archived",
  custom: "Custom editor",
  standard: "Ready to upgrade",
  update: "Update available",
  missing: "Folder unavailable",
  repair: "Repair installation",
};

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.hidden = false;
  toastTimer = setTimeout(
    () => {
      element.hidden = true;
    },
    error ? 12000 : 8500,
  );
}

function guard(action) {
  return async () => {
    try {
      await action();
    } catch (error) {
      toast(error.message, true);
    }
  };
}

function setWorking(value) {
  working = value;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = value;
  });
  $("#search").disabled = value;
  document.querySelectorAll("dialog input, dialog select").forEach((input) => {
    input.disabled = value;
  });
  if (!value) render();
}

async function refresh() {
  data = await window.vaults.list();
  $("#bundle-version").textContent = data.version;
  $("#warning").textContent = data.warning;
  $("#warning").hidden = !data.warning;
  render();
}

function clone(template) {
  return $(template).content.firstElementChild.cloneNode(true);
}

function render() {
  const custom = data.vaults.filter((v) =>
    ["custom", "update"].includes(v.status),
  );
  const upgrade = data.vaults.filter((v) =>
    ["standard", "update", "repair"].includes(v.status),
  );
  $("#archive-count").textContent = data.archived.length;
  $("#archive-note").hidden = filter !== "archive";
  $(".welcome").hidden = filter === "archive";
  $("#all-count").textContent = data.vaults.length;
  $("#custom-count").textContent = custom.length;
  $("#upgrade-count").textContent = upgrade.length;
  const query = $("#search").value.trim().toLowerCase();
  let source =
    filter === "archive"
      ? data.archived
      : filter === "custom"
        ? custom
        : filter === "upgrade"
          ? upgrade
          : data.vaults;
  if (folderFilter)
    source = source.filter((vault) =>
      folderFilter === "unfiled"
        ? !vault.folder
        : vault.folder === folderFilter,
    );
  const visible = source.filter((vault) =>
    `${vault.name} ${vault.path}`.toLowerCase().includes(query),
  );
  $("#section-title").textContent = {
    archive: "Archive",
    all: "All vaults",
    custom: "Custom editor",
    upgrade: "Ready to upgrade",
  }[filter];
  if (folderFilter)
    $("#section-title").textContent =
      folderFilter === "unfiled"
        ? "Unfiled"
        : (data.folders.find((folder) => folder.id === folderFilter)?.name ??
          "All vaults");
  renderFolders();
  $("#result-count").textContent =
    `${visible.length} ${visible.length === 1 ? "space" : "spaces"}`;
  const gallery = $("#gallery");
  gallery.replaceChildren();
  visible.forEach((vault) => {
    const card = clone("#card-template");
    card.dataset.tone =
      [...vault.name].reduce(
        (sum, character) => sum + character.charCodeAt(0),
        0,
      ) % 4;
    card.querySelector(".card-name").textContent = vault.name;
    card.querySelector(".card-name").title = vault.name;
    card.querySelector(".card-path").textContent = vault.path;
    card.querySelector(".card-path").title = vault.path;
    const folder = data.folders.find((item) => item.id === vault.folder);
    card.querySelector(".card-folder").hidden = !folder;
    card.querySelector(".card-folder").textContent = folder
      ? `▱ ${folder.name}`
      : "";
    const coverButton = card.querySelector(".cover-button");
    coverButton.disabled = working;
    coverButton.setAttribute("aria-label", `Change cover for ${vault.name}`);
    coverButton.addEventListener(
      "click",
      guard(() => showCover(vault)),
    );
    if (vault.cover) {
      card.querySelector(".card-art").classList.add("has-cover");
      const image = card.querySelector(".cover-image");
      image.src = vault.cover.src;
      image.hidden = false;
      const credit = card.querySelector(".cover-credit");
      credit.hidden = !vault.cover.credit;
      credit.textContent = vault.cover.credit;
      credit.addEventListener(
        "click",
        guard(() => window.vaults.credit(vault.cover.preset)),
      );
    }
    const reload = card.querySelector(".reload-button");
    reload.hidden = !vault.reloadPending || vault.status === "archived";
    reload.disabled = working;
    reload.addEventListener(
      "click",
      guard(async () => {
        setWorking(true);
        try {
          const result = await window.vaults.reload(vault.path);
          await refresh();
          toast(
            result.message ||
              (result.status === "closed"
                ? "Your editor will load when you open this vault."
                : "Editor reloaded. Your drawing is ready."),
            result.status === "pending",
          );
        } finally {
          setWorking(false);
        }
      }),
    );
    const manage = card.querySelector(".manage-vault");
    manage.disabled = working;
    manage.hidden = vault.status === "archived";
    manage.setAttribute("aria-label", `Manage ${vault.name}`);
    manage.addEventListener("click", () => showManage(vault));
    const badge = card.querySelector(".badge");
    badge.textContent = labels[vault.status];
    badge.classList.add(vault.status);
    const action = card.querySelector(".card-action");
    action.textContent = {
      archived: "Restore vault ↗",
      custom: "Open in Obsidian ↗",
      standard: "Upgrade vault ↗",
      update: "Update custom editor ↗",
      missing: "Reconnect folder",
      repair: "Repair custom editor ↗",
    }[vault.status];
    action.disabled = working || vault.status === "missing";
    action.addEventListener(
      "click",
      guard(async () => {
        if (vault.status === "archived") await restore(vault.path);
        else if (vault.status === "custom")
          await window.vaults.open(vault.path);
        else await install({ mode: "upgrade", path: vault.path });
      }),
    );
    const reveal = card.querySelector(".reveal");
    reveal.disabled = working || vault.status === "missing";
    reveal.setAttribute("aria-label", `Show ${vault.name} in Finder`);
    reveal.addEventListener(
      "click",
      guard(() => window.vaults.reveal(vault.path)),
    );
    const backup = card.querySelector(".backup-button");
    backup.hidden = !vault.backup;
    backup.disabled = working || vault.status === "missing";
    backup.addEventListener(
      "click",
      guard(() => window.vaults.backup(vault.path)),
    );
    gallery.append(card);
  });
  if (!visible.length) {
    const empty = clone("#empty-template");
    empty.querySelector("strong").textContent = query
      ? "No matching vaults"
      : filter === "archive"
        ? "Nothing archived yet."
        : filter === "upgrade"
          ? "All caught up."
          : "Your next idea starts here.";
    empty.querySelector("p").textContent = query
      ? "Try another name or folder."
      : filter === "archive"
        ? "Vaults you archive will appear here, ready to restore."
        : filter === "upgrade"
          ? "Add an existing vault whenever you’re ready."
          : "Create a vault or add an existing one to your gallery.";
    gallery.append(empty);
  }
  if (filter === "all" && !query) {
    const add = clone("#add-template");
    add.disabled = working;
    add.addEventListener("click", showCreate);
    gallery.append(add);
  }
}

function showCreate() {
  if (working) return;
  $("#form-error").textContent = "";
  $("#toast").hidden = true;
  $("#create-dialog").showModal();
  $("#vault-name").focus();
}

async function install(request) {
  setWorking(true);
  try {
    const result = await window.vaults.install(request);
    if (!result) return;
    await refresh();
    $("#create-dialog").close();
    $("#vault-name").value = "";
    toast(
      result.warning ||
        result.reload?.message ||
        (request.mode === "upgrade"
          ? result.reload?.status === "reloaded"
            ? "Upgraded and reloaded. Your custom editor is ready."
            : "Upgraded. Your custom editor will load when you open this vault."
          : "Your vault is ready. Open it in Obsidian and allow community plugins if prompted."),
    );
  } finally {
    setWorking(false);
  }
}

$("#new-vault").addEventListener("click", showCreate);
$("#close-dialog").addEventListener("click", () => $("#create-dialog").close());
$("#cancel-create").addEventListener("click", () =>
  $("#create-dialog").close(),
);
$("#create-dialog").addEventListener("cancel", (event) => {
  if (working) event.preventDefault();
});
$("#choose-parent").addEventListener(
  "click",
  guard(async () => {
    const selected = await window.vaults.choose("parent");
    if (!selected) return;
    parent = selected;
    $("#form-error").textContent = "";
    $("#choose-parent").textContent = parent;
  }),
);
$("#create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (working) return;
  $("#form-error").textContent = "";
  if (!parent) {
    $("#form-error").textContent = "Choose a location for your new vault.";
    return;
  }
  $("#create-submit").textContent = "Creating…";
  try {
    await install({
      mode: "create",
      parent,
      name: $("#vault-name").value,
      folder: folderFilter === "unfiled" ? null : folderFilter,
    });
  } catch (error) {
    $("#form-error").textContent = error.message;
  } finally {
    $("#create-submit").textContent = "Create vault ↗";
  }
});
$("#add-existing").addEventListener(
  "click",
  guard(async () => {
    if (await window.vaults.choose("existing")) await refresh();
  }),
);
$("#refresh").addEventListener("click", guard(refresh));
$("#search").addEventListener("input", render);
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    folderFilter = null;
    document
      .querySelectorAll("[data-filter]")
      .forEach((item) => item.classList.toggle("selected", item === button));
    render();
  });
});
refresh().catch((error) => {
  $("#result-count").textContent = "Could not load vaults";
  toast(error.message, true);
});

function selectFolder(id) {
  folderFilter = id;
  filter = "all";
  document
    .querySelectorAll("[data-filter]")
    .forEach((button) => button.classList.remove("selected"));
  render();
}

function renderFolders() {
  $("#unfiled-count").textContent = data.vaults.filter(
    (vault) => !vault.folder,
  ).length;
  $("#unfiled").classList.toggle("selected", folderFilter === "unfiled");
  $("#folder-list").replaceChildren();
  data.folders.forEach((folder) => {
    const row = clone("#folder-template");
    row.querySelector(".folder-label").textContent = folder.name;
    row.querySelector(".count").textContent = data.vaults.filter(
      (vault) => vault.folder === folder.id,
    ).length;
    const button = row.querySelector(".folder-filter");
    button.classList.toggle("selected", folder.id === folderFilter);
    button.disabled = working;
    button.addEventListener("click", () => selectFolder(folder.id));
    const edit = row.querySelector(".folder-edit");
    edit.disabled = working;
    edit.setAttribute("aria-label", `Edit folder ${folder.name}`);
    edit.addEventListener("click", () => showFolder(folder));
    $("#folder-list").append(row);
  });
}

function showManage(vault) {
  editingVault = vault;
  $("#manage-title").textContent = vault.name;
  $("#manage-path").textContent = vault.path;
  $("#rename-name").value = vault.name;
  $("#rename-name").disabled = vault.status === "missing";
  $("#rename-submit").disabled = vault.status === "missing";
  $("#manage-error").textContent = "";
  $("#remove-confirm").hidden = true;
  $("#folder-select").replaceChildren();
  [{ id: "", name: "Unfiled" }, ...data.folders].forEach((folder) => {
    const option = clone("#option-template");
    option.value = folder.id;
    option.textContent = folder.name;
    $("#folder-select").append(option);
  });
  $("#folder-select").value = vault.folder ?? "";
  $("#toast").hidden = true;
  $("#manage-dialog").showModal();
}

function showFolder(folder = null) {
  editingFolder = folder;
  $("#folder-title").textContent = folder ? "Edit folder" : "New folder";
  $("#folder-name").value = folder?.name ?? "";
  $("#save-folder").textContent = folder ? "Save folder" : "Create folder";
  $("#remove-folder").hidden = !folder;
  $("#folder-remove-note").hidden = !folder;
  $("#folder-error").textContent = "";
  $("#folder-dialog").showModal();
  $("#folder-name").focus();
}

async function change(action, dialog, errorElement, message) {
  if (working) return;
  setWorking(true);
  $(errorElement).textContent = "";
  try {
    await action();
    await refresh();
    $(dialog).close();
    toast(message);
  } catch (error) {
    $(errorElement).textContent = error.message;
  } finally {
    setWorking(false);
  }
}

$("#new-folder").addEventListener("click", () => showFolder());
$("#unfiled").addEventListener("click", () => selectFolder("unfiled"));
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      $("#" + button.dataset.close).close(),
    ),
  );
for (const dialog of [
  "#manage-dialog",
  "#folder-dialog",
  "#cover-dialog",
])
  $(dialog).addEventListener("cancel", (event) => {
    if (working) event.preventDefault();
  });
$("#rename-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void change(
    () => window.vaults.rename(editingVault.path, $("#rename-name").value),
    "#manage-dialog",
    "#manage-error",
    "Vault renamed. Obsidian’s vault list is updated.",
  );
});
$("#move-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void change(
    () =>
      window.vaults.move(editingVault.path, $("#folder-select").value || null),
    "#manage-dialog",
    "#manage-error",
    "Vault moved to its dashboard folder. Files stayed in place.",
  );
});
$("#show-remove").addEventListener("click", () => {
  $("#remove-confirm").hidden = false;
});
$("#confirm-remove").addEventListener("click", () => {
  void change(
    () => window.vaults.remove(editingVault.path),
    "#manage-dialog",
    "#manage-error",
    "Moved to Archive. Restore it anytime; all files are still on your Mac.",
  );
});
$("#folder-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void change(
    async () => {
      const id = await window.vaults.folder(
        editingFolder ? "rename" : "create",
        editingFolder?.id ?? null,
        $("#folder-name").value,
      );
      selectFolder(id);
    },
    "#folder-dialog",
    "#folder-error",
    editingFolder
      ? "Folder renamed."
      : "Folder created. Use a vault’s management button to move it here.",
  );
});
$("#remove-folder").addEventListener("click", () => {
  void change(
    async () => {
      await window.vaults.folder("remove", editingFolder.id);
      if (folderFilter === editingFolder.id) folderFilter = "unfiled";
    },
    "#folder-dialog",
    "#folder-error",
    "Folder removed. Its vaults are now Unfiled.",
  );
});

async function restore(directory) {
  if (working) return;
  setWorking(true);
  try {
    await window.vaults.restore(directory);
    await refresh();
    toast(
      "Restored to All vaults and Obsidian’s vault list, with its folder assignment preserved.",
    );
  } finally {
    setWorking(false);
  }
}

const coverBrowser = createCoverBrowser({
  selectedVault: () => coverVault,
  apply: (path, id) =>
    change(
      () => window.vaults.unsplashSelect(path, id),
      "#cover-dialog",
      "#cover-error",
      "Cover updated.",
    ),
});
async function showCover(vault) {
  if (working) return;
  coverVault = vault;
  $("#cover-vault").textContent = vault.name;
  $("#cover-error").textContent = "";
  $("#toast").hidden = true;
  $("#remove-cover").hidden = !vault.cover;
  if (!presets) presets = await window.vaults.presets();
  $("#cover-presets").replaceChildren();
  for (const preset of presets) {
    const tile = clone("#preset-template");
    const button = tile.querySelector(".preset-choice");
    button.setAttribute("aria-label", `Use ${preset.title} cover`);
    button.setAttribute("aria-pressed", String(vault.cover?.id === preset.id));
    tile.querySelector("img").src = `assets/covers/${preset.id}.jpg`;
    tile.querySelector(".preset-title").textContent = preset.title;
    tile.querySelector(".preset-check").hidden = vault.cover?.id !== preset.id;
    button.addEventListener("click", () =>
      change(
        () => window.vaults.cover(vault.path, preset.id),
        "#cover-dialog",
        "#cover-error",
        "Cover updated.",
      ),
    );
    const credit = tile.querySelector(".preset-credit");
    credit.textContent = `${preset.author} / Unsplash ↗`;
    credit.addEventListener("click", (event) => {
      event.preventDefault();
      void guard(() => window.vaults.credit(preset.id))();
    });
    $("#cover-presets").append(tile);
  }
  await coverBrowser.open();
  $("#cover-dialog").showModal();
}
$("#upload-cover").addEventListener("click", async () => {
  if (working) return;
  setWorking(true);
  $("#cover-error").textContent = "";
  try {
    if (await window.vaults.uploadCover(coverVault.path)) {
      await refresh();
      $("#cover-dialog").close();
      toast("Cover saved on your Mac.");
    }
  } catch (error) {
    $("#cover-error").textContent = error.message;
  } finally {
    setWorking(false);
  }
});
$("#remove-cover").addEventListener("click", () =>
  change(
    () => window.vaults.cover(coverVault.path, null),
    "#cover-dialog",
    "#cover-error",
    "Default artwork restored.",
  ),
);

$("#new-post").addEventListener(
  "click",
  guard(async () => {
    if (working) return;
    if (!(await window.vaults.blogStatus()).siteDirectory) {
      toast("Choose your website folder (the one with _config.yml).");
      if (!(await window.vaults.blogChoose())) return;
    }
    const { file, editor } = await window.vaults.blogCreate();
    toast(`Draft ${file.split("/").pop()} opened in ${editor}.`);
  }),
);
