document.addEventListener("DOMContentLoaded", () => {
  const viewButtons = document.querySelectorAll("[data-photo-view-button]");
  const photoViews = document.querySelectorAll("[data-photo-view]");

  viewButtons.forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.photoViewButton;
    viewButtons.forEach((item) => item.classList.toggle("active", item === button));
    photoViews.forEach((item) => { item.hidden = item.dataset.photoView !== view; });
  }));

  const grid = document.querySelector(".photo-grid[data-folder-id]");
  const detailList = document.querySelector('[data-photo-view="detail"] tbody');
  const sort = document.querySelector("#photo-sort");
  const status = document.querySelector("#photo-order-status");
  const previewDialog = document.querySelector("#photo-preview-dialog");
  const previewImage = document.querySelector("#photo-preview-image");

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-photo-preview-src]");
    if (trigger && previewDialog && previewImage) {
      previewImage.src = trigger.dataset.photoPreviewSrc;
      previewImage.alt = trigger.dataset.photoPreviewAlt ?? "";
      previewDialog.showModal();
      return;
    }

    if (event.target.closest("[data-photo-preview-close]") && previewDialog) {
      previewDialog.close();
      return;
    }

    if (event.target === previewDialog) previewDialog.close();
  });

  previewDialog?.addEventListener("close", () => {
    if (previewImage) previewImage.removeAttribute("src");
  });

  if (!grid || !sort) return;

  let manualOrder = tileIds();
  let draggedTile = null;

  function tiles() {
    return [...grid.querySelectorAll(".photo-tile")];
  }

  function tileIds() {
    return tiles().map((tile) => tile.dataset.photoId).filter(Boolean);
  }

  function setStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function render(ids) {
    const byId = new Map(tiles().map((tile) => [tile.dataset.photoId, tile]));
    ids.forEach((id) => {
      const tile = byId.get(id);
      if (tile) grid.append(tile);
    });
  }

  function renderDetailList(ids) {
    if (!detailList) return;
    const byId = new Map([...detailList.querySelectorAll("tr[data-photo-id]")].map((row) => [row.dataset.photoId, row]));
    ids.forEach((id) => {
      const row = byId.get(id);
      if (row) detailList.append(row);
    });
  }

  function updateDraggable() {
    tiles().forEach((tile) => { tile.draggable = sort.value === "manual"; });
  }

  function applySort() {
    if (sort.value === "manual") {
      render(manualOrder);
      renderDetailList(manualOrder);
      setStatus("Drag photos to set their slideshow order.");
    } else if (sort.value === "alphabetical") {
      const ids = tiles().sort((left, right) => (left.dataset.photoName ?? "").localeCompare(right.dataset.photoName ?? "")).map((tile) => tile.dataset.photoId);
      render(ids);
      renderDetailList(ids);
      setStatus("Showing photos alphabetically. Switch to Manual to rearrange the slideshow.");
    } else {
      const ids = tiles().sort((left, right) => (right.dataset.photoCreatedAt ?? "").localeCompare(left.dataset.photoCreatedAt ?? "")).map((tile) => tile.dataset.photoId);
      render(ids);
      renderDetailList(ids);
      setStatus("Showing newest uploads first. Switch to Manual to rearrange the slideshow.");
    }
    updateDraggable();
  }

  async function persistManualOrder() {
    const photoIds = tileIds();
    manualOrder = photoIds;
    renderDetailList(photoIds);
    setStatus("Saving manual order…");
    try {
      const response = await fetch("/admin/photos/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ folderId: grid.dataset.folderId, photoIds: JSON.stringify(photoIds) })
      });
      if (!response.ok) throw new Error("Could not save manual order.");
      setStatus("Manual slideshow order saved.", "success");
    } catch {
      setStatus("Could not save the order. Refresh and try again.", "error");
    }
  }

  sort.addEventListener("change", applySort);
  grid.addEventListener("dragstart", (event) => {
    if (sort.value !== "manual") return;
    const tile = event.target.closest(".photo-tile");
    if (!tile) return;
    draggedTile = tile;
    tile.classList.add("is-dragging");
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  grid.addEventListener("dragover", (event) => {
    if (!draggedTile || sort.value !== "manual") return;
    event.preventDefault();
    const target = event.target.closest(".photo-tile");
    if (!target || target === draggedTile) return;
    const before = event.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2;
    grid.insertBefore(draggedTile, before ? target : target.nextSibling);
  });
  grid.addEventListener("dragend", () => {
    if (!draggedTile) return;
    draggedTile.classList.remove("is-dragging");
    draggedTile = null;
    void persistManualOrder();
  });

  applySort();
});
