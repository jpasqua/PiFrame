const presentationForm = document.querySelector('form[action="/admin/presentation/save"]');

if (presentationForm) {
  const orderSelect = presentationForm.querySelector('select[name="orderMode"]');
  const orderMode = document.querySelector('meta[name="presentation-order-mode"]')?.content;
  if (orderSelect && !orderSelect.querySelector('option[value="manual"]')) {
    const option = document.createElement("option");
    option.value = "manual";
    option.textContent = "Manual album order";
    orderSelect.append(option);
  }
  if (orderSelect && orderMode === "manual") orderSelect.value = "manual";

  const orderInput = document.createElement("input");
  orderInput.type = "hidden";
  orderInput.name = "folderOrder";
  orderInput.value = document.querySelector('meta[name="presentation-folder-order"]')?.content || "[]";
  presentationForm.append(orderInput);

  let order;
  try { order = JSON.parse(orderInput.value); } catch { order = []; }
  if (!Array.isArray(order)) order = [];
  const folderInputs = [...presentationForm.querySelectorAll('#folder-choices input[type="checkbox"]')];
  folderInputs.forEach((input) => input.addEventListener("change", () => {
    const folderId = input.name.replace(/^folder-/, "");
    order = order.filter((id) => id !== folderId);
    if (input.checked) order.push(folderId);
    orderInput.value = JSON.stringify(order);
  }));
  presentationForm.addEventListener("submit", () => {
    const selected = new Set(folderInputs.filter((input) => input.checked).map((input) => input.name.replace(/^folder-/, "")));
    orderInput.value = JSON.stringify([...order.filter((id) => selected.has(id)), ...[...selected].filter((id) => !order.includes(id))]);
  });

  addTransitionControls(presentationForm);
  arrangeClockControls(presentationForm);
  arrangeWeatherControls(presentationForm);
}

function addTransitionControls(form) {
  const layoutField = form.querySelector('select[name="screenLayout"]')?.closest("label");
  if (!layoutField || form.querySelector('select[name="transitionStyle"]')) return;
  const transitionStyle = document.querySelector('meta[name="presentation-transition-style"]')?.content || "none";
  const transitionDuration = document.querySelector('meta[name="presentation-transition-duration"]')?.content || "0.5";
  const transitions = [["none", "No transition"], ["crossfade", "Crossfade"], ["fade-black", "Fade through black"], ["slide-left", "Swipe left"], ["slide-right", "Swipe right"], ["slow-pan", "Gentle zoom"]];
  const options = transitions.map(([value, label]) => `<option value="${value}"${value === transitionStyle ? " selected" : ""}>${label}</option>`).join("");
  const fields = document.createElement("div");
  fields.className = "transition-fields";
  fields.innerHTML = `<label class="inline-field"><span>Transition:</span><select name="transitionStyle">${options}</select></label><label class="inline-field"><span>Transition duration:</span><input type="number" name="transitionDurationSeconds" min="0.2" max="3" step="0.1" value="${transitionDuration}" required></label>`;
  layoutField.insertAdjacentElement("afterend", fields);
}

function arrangeClockControls(form) {
  const enabled = form.querySelector('input[name="clockEnabled"]');
  const format = form.querySelector('select[name="clockFormat"]');
  const size = form.querySelector('select[name="clockSize"]');
  const date = form.querySelector('input[name="clockShowDate"]');
  const section = enabled?.closest(".section");
  if (!enabled || !format || !size || !date || !section) return;
  const labels = [enabled, format, size, date].map((control) => control.closest("label")).filter(Boolean);
  const settings = document.createElement("div"); settings.className = "clock-settings";
  section.insertBefore(settings, labels[0] || null);
  const enabledLabel = document.createElement("label"); enabledLabel.className = "clock-enabled"; enabledLabel.append(enabled, document.createTextNode(" Show clock"));
  const options = document.createElement("div"); options.className = "clock-options";
  const makeRow = (caption, control) => { const row = document.createElement("label"); row.className = "clock-row"; const title = document.createElement("span"); title.textContent = caption; row.append(title, control); return row; };
  const toggles = document.createElement("span"); toggles.className = "clock-toggles";
  const dateLabel = document.createElement("label"); dateLabel.append(date, document.createTextNode(" Date")); toggles.append(dateLabel);
  options.append(makeRow("Format:", format), makeRow("Size:", size), makeRow("Show:", toggles));
  settings.append(enabledLabel, options); labels.forEach((label) => label.remove());
  const sync = () => { options.hidden = !enabled.checked; };
  enabled.addEventListener("change", sync); sync();
}

function arrangeWeatherControls(form) {
  const enabled = form.querySelector('input[name="weatherEnabled"]');
  const current = form.querySelector('input[name="weatherShowCurrent"]');
  const forecast = form.querySelector('input[name="weatherShowForecast"]');
  const units = form.querySelector('select[name="weatherUnits"]');
  const section = enabled?.closest(".section");
  if (!enabled || !current || !forecast || !units || !section) return;
  const labels = [enabled, current, forecast, units].map((control) => control.closest("label")).filter(Boolean);
  const settings = document.createElement("div"); settings.className = "weather-settings";
  section.insertBefore(settings, labels[0] || null);
  const enabledLabel = document.createElement("label"); enabledLabel.className = "weather-enabled"; enabledLabel.append(enabled, document.createTextNode(" Show weather"));
  const options = document.createElement("div"); options.className = "weather-options";
  const choices = document.createElement("span"); choices.className = "weather-toggles";
  const currentLabel = document.createElement("label"); currentLabel.append(current, document.createTextNode(" Current conditions"));
  const forecastLabel = document.createElement("label"); forecastLabel.append(forecast, document.createTextNode(" 5-day forecast")); choices.append(currentLabel, forecastLabel);
  const unitRow = document.createElement("label"); unitRow.className = "clock-row"; const title = document.createElement("span"); title.textContent = "Units:"; unitRow.append(title, units);
  options.append(choices, unitRow); settings.append(enabledLabel, options); labels.forEach((label) => label.remove());
  const sync = () => { options.hidden = !enabled.checked; };
  enabled.addEventListener("change", sync); sync();
}
