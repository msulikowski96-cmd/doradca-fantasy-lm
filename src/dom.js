// Drobne pomocniki DOM wspólne dla app.js, account.js i admin.js.
export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtDateTime = d => new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(new Date(d));
