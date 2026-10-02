/** Luma-inspired photo picker; only the main process speaks to the Unsplash API. */
export function createCoverBrowser({ selectedVault, apply }) {
  const $ = (selector) => document.querySelector(selector);
  let connected = false,
    query = "nature",
    page = 0,
    hasMore = false;
  let chosen = null,
    generation = 0,
    loading = false,
    changing = false;
  const error = (message = "") => {
    $("#cover-error").textContent = message;
  };
  function selectTab(online) {
    $("#curated-tab").setAttribute("aria-selected", String(!online));
    $("#unsplash-tab").setAttribute("aria-selected", String(online));
    $("#curated-panel").hidden = online;
    $("#unsplash-panel").hidden = !online;
    if (online && connected && page === 0 && !loading) void search(true);
  }
  function clearSelection() {
    chosen = null;
    $("#photo-preview").hidden = true;
    for (const button of document.querySelectorAll(".photo-choice"))
      button.setAttribute("aria-pressed", "false");
  }
  function updateConnection() {
    $("#unsplash-connect").hidden = connected;
    $("#unsplash-library").hidden = !connected;
    $("#photo-search").hidden = !connected;
    $(".photo-topics").hidden = !connected;
  }
  function renderPhoto(photo) {
    const tile = document.createElement("div");
    tile.className = "photo-tile";
    const button = document.createElement("button");
    button.className = "photo-choice";
    button.setAttribute(
      "aria-label",
      `Preview ${photo.title} by ${photo.author}`,
    );
    button.setAttribute("aria-pressed", "false");
    const image = document.createElement("img");
    image.src = photo.thumb;
    image.alt = photo.title;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    button.append(image);
    button.addEventListener("click", () => {
      if (changing) return;
      clearSelection();
      chosen = photo;
      button.setAttribute("aria-pressed", "true");
      $("#photo-preview-image").src = photo.src;
      $("#photo-preview-title").textContent = selectedVault().name;
      $("#photo-preview-credit").textContent =
        `Photo by ${photo.author} on Unsplash`;
      $("#photo-preview").hidden = false;
    });
    const credit = document.createElement("a");
    credit.href = photo.creditURL;
    credit.textContent = `${photo.author} / Unsplash ↗`;
    credit.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await window.vaults.unsplashCredit(photo.id);
      } catch (e) {
        error(e.message);
      }
    });
    tile.append(button, credit);
    $("#photo-grid").append(tile);
  }
  async function search(reset) {
    if (!connected || changing) return;
    if (!reset && (loading || !hasMore)) return;
    const request = ++generation;
    const next = reset ? 1 : page + 1;
    if (reset) {
      query = $("#photo-query").value.trim() || "nature";
      page = 0;
      clearSelection();
      $("#photo-grid").replaceChildren();
    }
    loading = true;
    error();
    $("#photo-status").textContent = "Searching…";
    $("#photo-more").hidden = true;
    try {
      const result = await window.vaults.unsplashSearch(query, next);
      if (request !== generation) return;
      result.photos.forEach(renderPhoto);
      page = next;
      hasMore = result.hasMore;
      const count = $("#photo-grid").childElementCount;
      $("#photo-status").textContent = count
        ? `${count} photos · ${query}`
        : "No photos found. Try another search.";
    } catch (e) {
      if (request === generation) {
        error(e.message);
        $("#photo-status").textContent = "Search unavailable. Try again.";
      }
    } finally {
      if (request === generation) {
        loading = false;
        $("#photo-more").hidden = !hasMore || page === 0;
      }
    }
  }
  $("#curated-tab").addEventListener("click", () => selectTab(false));
  $("#unsplash-tab").addEventListener("click", () => selectTab(true));
  for (const tab of [$("#curated-tab"), $("#unsplash-tab")])
    tab.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const online =
          event.key === "End" ||
          (event.key !== "Home" && tab.id === "curated-tab");
        selectTab(online);
        $(online ? "#unsplash-tab" : "#curated-tab").focus();
      }
    });
  $("#photo-search").addEventListener("submit", (event) => {
    event.preventDefault();
    void search(true);
  });
  for (const topic of document.querySelectorAll("[data-topic]"))
    topic.addEventListener("click", () => {
      $("#photo-query").value = topic.dataset.topic;
      void search(true);
    });
  $("#photo-more").addEventListener("click", () => void search(false));
  $("#unsplash-setup").addEventListener("click", async () => {
    try {
      await window.vaults.unsplashSetup();
    } catch (e) {
      error(e.message);
    }
  });
  $("#unsplash-key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (changing) return;
    changing = true;
    const button = event.submitter;
    button.disabled = true;
    error();
    try {
      await window.vaults.unsplashConnect($("#unsplash-key").value);
      connected = true;
      page = 0;
      updateConnection();
    } catch (e) {
      error(e.message);
    } finally {
      $("#unsplash-key").value = "";
      changing = false;
      button.disabled = false;
    }
    if (connected) void search(true);
  });
  $("#unsplash-disconnect").addEventListener("click", async () => {
    if (changing) return;
    changing = true;
    try {
      await window.vaults.unsplashDisconnect();
      ++generation;
      connected = false;
      loading = false;
      page = 0;
      hasMore = false;
      $("#photo-grid").replaceChildren();
      clearSelection();
      updateConnection();
      error();
    } catch (e) {
      error(e.message);
    } finally {
      changing = false;
    }
  });
  $("#photo-use").addEventListener("click", async () => {
    if (!chosen || changing) return;
    changing = true;
    try {
      await apply(selectedVault().path, chosen.id);
    } finally {
      changing = false;
    }
  });
  $("#cover-dialog").addEventListener("close", () => {
    ++generation;
    loading = false;
    $("#unsplash-key").value = "";
    clearSelection();
  });
  return {
    async open() {
      clearSelection();
      try {
        connected = (await window.vaults.unsplashStatus()).connected;
      } catch (e) {
        connected = false;
        error(e.message);
      }
      updateConnection();
      if (!page) selectTab(false);
    },
  };
}
