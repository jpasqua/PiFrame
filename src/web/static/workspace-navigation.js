const buttons = document.querySelectorAll("[data-section]");
const panels = document.querySelectorAll("[data-panel]");
const title = document.querySelector("#section-title");
const allFolders = document.querySelector("#all-folders");
const folderChoices = document.querySelector("#folder-choices");
const about = document.querySelector("#about-dialog");
const helpToc = document.querySelector("#help-toc");
const helpContent = document.querySelector("#help-content");
const openFrameLink = document.querySelector("#open-frame-link");
const labels = { dashboard: "Dashboard", general: "Frame", presentation: "Presentation", schedule: "Schedule", folders: "Albums", status: "System Status", help: "Help" };

function selectSection(section) {
  if (section !== "general") window.resetAdministrationThemePreview?.();
  buttons.forEach((button) => button.classList.toggle("active", button.dataset.section === section));
  panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== section; });
  if (helpToc) helpToc.hidden = section !== "help";
  if (openFrameLink) openFrameLink.hidden = section === "general";
  if (title) title.textContent = labels[section] || section;
  history.replaceState(null, "", `/?view=${section}`);
  if (section === "dashboard") void refreshDashboardStatus();
}

async function refreshDashboardStatus() {
  const dashboard = document.querySelector("[data-panel=dashboard]");
  if (!dashboard) return;
  try {
    const response = await fetch("/api/display/next?probe=1", { cache: "no-store" });
    if (!response.ok) return;
    const { displayOn } = await response.json();
    const ready = Number(dashboard.querySelector("[data-dashboard-ready]")?.dataset.dashboardReady || 0);
    const status = dashboard.querySelector("#dashboard-display-status");
    const heading = dashboard.querySelector("#dashboard-display-heading");
    const message = dashboard.querySelector("#dashboard-display-message");
    const schedule = dashboard.querySelector("#dashboard-schedule-state");
    if (displayOn) {
      if (status) status.textContent = "Displaying now";
      if (heading) heading.textContent = ready > 0 ? "Your frame is on." : "Waiting for photos.";
      if (message) message.textContent = `${ready} ready photo${ready === 1 ? "" : "s"} are available for display.`;
      if (schedule) schedule.textContent = "On";
    } else {
      if (status) status.textContent = "Display is off";
      if (heading) heading.textContent = "Resting quietly.";
      if (message) message.textContent = "The schedule or an override has set the display to black.";
      if (schedule) schedule.textContent = "Off";
    }
  } catch {
    // Keep the server-rendered dashboard state if a refresh is unavailable.
  }
}

buttons.forEach((button) => button.addEventListener("click", () => selectSection(button.dataset.section)));

if (helpContent) {
  fetch("/help")
    .then((response) => {
      if (!response.ok) throw new Error("Could not load help.");
      return response.text();
    })
    .then((markup) => {
      const documentFragment = new DOMParser().parseFromString(markup, "text/html");
      const manual = documentFragment.querySelector(".shell main");
      if (!manual) throw new Error("Help content was invalid.");
      helpContent.replaceChildren(...manual.children);
    })
    .catch(() => { helpContent.textContent = "Help could not be loaded. Refresh and try again."; });
}

helpToc?.querySelectorAll("[data-help-section]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  helpContent?.querySelector(`#${link.dataset.helpSection}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}));

function syncFolders() {
  if (!allFolders || !folderChoices) return;
  folderChoices.style.opacity = allFolders.checked ? ".5" : "1";
  folderChoices.querySelectorAll("input").forEach((input) => { input.disabled = allFolders.checked; });
}

allFolders?.addEventListener("change", syncFolders);
syncFolders();

document.querySelectorAll(".piframe-logo").forEach((logo) => logo.addEventListener("click", (event) => {
  event.preventDefault();
  about?.showModal();
}));
document.querySelector("#about-close")?.addEventListener("click", () => about?.close());
if (new URLSearchParams(location.search).has("about")) about?.showModal();
