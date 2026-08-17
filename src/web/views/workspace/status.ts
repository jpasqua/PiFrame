export function renderStatusPanel(active: boolean, systemDetails: string, storageDetails: string, systemActionControls: string, eventRows: string): string {
  return `<section class="panel" data-panel="status"${active ? "" : " hidden"}><section class="card"><h3>System</h3>${systemDetails}</section><section class="card" style="margin-top:16px"><h3>Storage</h3>${storageDetails}</section>${systemActionControls}<section class="card" style="margin-top:16px"><h3>Recent activity</h3>${eventRows}</section></section>`;
}
