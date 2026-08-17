export function renderHelpContents(active: boolean): string {
  return `<nav id="help-toc" class="help-toc" aria-label="Help contents"${active ? "" : " hidden"}><a href="#overview" data-help-section="overview">Overview</a><a href="#first-connection" data-help-section="first-connection">First connection</a><a href="#start" data-help-section="start">Quick start</a><a href="#views" data-help-section="views">Views and controls</a><a href="#care" data-help-section="care">Everyday care</a></nav>`;
}

export function renderHelpPanel(active: boolean): string {
  return `<section class="panel help-panel" data-panel="help"${active ? "" : " hidden"}><div id="help-content" class="help-content" aria-live="polite">Loading help…</div></section>`;
}
