const themeColors = { neutral: "#fafafa", parchment: "#fbf8f0", surf: "#eef9f7", "lapis-velvet": "#ebe8ed", terrazzo: "#f6f0e7", pearl: "#f5f1ed", "signal-rain": "#050806", "obsidian-blue": "#0d1018" };
const savedTheme = document.documentElement.dataset.theme;

function applyThemePreview(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[theme]);
}

window.resetAdministrationThemePreview = () => {
  applyThemePreview(savedTheme);
  const savedThemeInput = document.querySelector(`input[name="theme"][value="${savedTheme}"]`);
  if (savedThemeInput) savedThemeInput.checked = true;
};

document.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener("change", () => {
  if (input.checked) applyThemePreview(input.value);
}));

[
  'form[action="/admin/general/save"]',
  'form[action="/admin/presentation/save"]',
  'form[action="/admin/schedule/save"]'
].forEach((selector) => {
  const form = document.querySelector(selector);
  const saveButton = form?.querySelector("button.save");
  const markDirty = () => { if (saveButton) saveButton.disabled = false; };
  form?.addEventListener("input", markDirty);
  form?.addEventListener("change", markDirty);
});

const overrideStatus = document.querySelector("#schedule-override-status");
document.querySelectorAll("form[data-schedule-override]").forEach((form) => form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  if (button) button.disabled = true;
  try {
    const response = await fetch(form.action, { method: "POST", headers: { Accept: "application/json" }, body: new URLSearchParams(new FormData(form)) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not change the frame override.");
    if (overrideStatus) overrideStatus.textContent = result.message;
  } catch (error) {
    if (overrideStatus) overrideStatus.textContent = error instanceof Error ? error.message : "Could not change the frame override.";
  } finally {
    if (button) button.disabled = false;
  }
}));
