document.addEventListener("DOMContentLoaded", () => {
  const viewButtons = document.querySelectorAll("[data-photo-view-button]");
  const photoViews = document.querySelectorAll("[data-photo-view]");

  viewButtons.forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.photoViewButton;
    viewButtons.forEach((item) => item.classList.toggle("active", item === button));
    photoViews.forEach((item) => { item.hidden = item.dataset.photoView !== view; });
  }));
});
