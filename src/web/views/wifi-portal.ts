import { escapeHtml } from "./shared.js";
import type { WifiPortalState } from "../../services/wifi-portal.js";

export function renderWifiPortalPage(state: WifiPortalState, error = ""): string {
  const message = state.message || "Connect a phone or computer to the temporary Wi-Fi network, then enter your home network below.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PiFrame Wi-Fi Setup</title>
<style>:root{font-family:system-ui,sans-serif;color:#273044;background:#f5f5f2}body{margin:0;padding:24px}.card{max-width:520px;margin:4vh auto;background:#fff;border:1px solid #d6d8dc;border-radius:12px;padding:28px;box-shadow:0 4px 20px #0001}h1{margin-top:0}label{display:grid;gap:6px;margin-top:16px;font-weight:650}input{font:inherit;padding:10px;border:1px solid #aeb3bb;border-radius:6px}button{margin-top:22px;padding:11px 16px;font:inherit;font-weight:700;border:0;border-radius:6px;background:#263a57;color:#fff}.error{color:#a12626;font-weight:650}</style>
</head><body><main class="card"><h1>Connect PiFrame to Wi-Fi</h1><p>${escapeHtml(message)}</p>${state.ssid ? `<p><strong>Temporary network:</strong> ${escapeHtml(state.ssid)}<br><strong>Setup address:</strong> ${escapeHtml(state.address || "http://10.42.0.1")}</p>` : ""}${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}<form method="post" action="/setup/connect"><label>Home Wi-Fi network<input name="ssid" maxlength="128" autocomplete="off" required></label><label>Password <input name="password" type="password" maxlength="128" autocomplete="current-password"></label><button type="submit">Connect</button></form></main></body></html>`;
}

export function renderWifiDisplayPage(state: WifiPortalState): string {
  const ssid = state.ssid || "PiFrame Setup";
  const address = state.address || "http://10.42.0.1";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="5"><title>PiFrame Wi-Fi Setup</title><style>html,body{width:100%;height:100%;margin:0;background:#16191f;color:#fff;font-family:system-ui,sans-serif}main{height:100%;display:grid;place-content:center;text-align:center;padding:40px}h1{font-size:clamp(2rem,5vw,4rem);margin:0 0 18px}p{font-size:clamp(1.1rem,2.5vw,1.7rem);line-height:1.5;margin:6px}.address{font-weight:700;color:#c8e2ff}</style></head><body><main><h1>Connect PiFrame to Wi-Fi</h1><p>Join the temporary network:</p><p class="address">${escapeHtml(ssid)}</p><p>Then open:</p><p class="address">${escapeHtml(address)}</p><p>${escapeHtml(state.message || "PiFrame will continue automatically after it connects.")}</p></main></body></html>`;
}
