"use strict";
/**
 * Shared report parser for Howdyknw.
 * Accepts both the original realtime tv_monitor.py format and
 * the tshark_capture export format of howdyknw.py.
 * Pure functions; no network access or tracking.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HowdyReport = api;
})(typeof window !== "undefined" ? window : null, function () {
  function positiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  function label(value) {
    return typeof value === "string" ? value.slice(0, 400) : "";
  }
  function uniqueList(values, max = 100) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map(label).filter(Boolean))].slice(0, max);
  }
  function normalizeReport(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.destinations) ||
        typeof raw.tv_ip !== "string" || raw.tv_ip.length > 128)
      throw Error("No es un informe Howdyknw válido.");
    if (raw.destinations.length > 50000)
      throw Error("El informe contiene demasiados destinos para mostrar.");
    const legacy = raw.schema_version === 1;
    const capture = raw.schema === 1 && raw.source === "tshark_capture";
    if (!legacy && !capture)
      throw Error("Formato incompatible. Importa un JSON de tv_monitor.py o howdyknw.py analyze.");
    const byIp = new Map();
    for (const row of raw.destinations) {
      if (!row || typeof row.ip !== "string" || !row.ip || row.ip.length > 128) continue;
      const ip = row.ip.trim();
      if (!byIp.has(ip)) byIp.set(ip, {
        ip, domains: [], ports: [], packets: 0, sent_bytes: 0, received_bytes: 0
      });
      const d = byIp.get(ip);
      d.packets += positiveNumber(row.packets);
      d.sent_bytes += positiveNumber(legacy ? row.sent_bytes : row.bytes);
      d.received_bytes += positiveNumber(legacy ? row.received_bytes : 0);
      d.domains.push(...uniqueList(legacy ? row.domains : row.tls_sni));
      const ports = legacy ? row.ports : [row.port];
      d.ports.push(...(Array.isArray(ports) ? ports : []).map(String).filter(p => /^\d{1,5}$/.test(p)));
    }
    const destinations = [...byIp.values()].map(d => ({
      ...d,
      domains: [...new Set(d.domains)].sort().slice(0, 100),
      ports: [...new Set(d.ports)].sort((a, b) => Number(a) - Number(b)).slice(0, 100)
    })).sort((a, b) =>
      (b.sent_bytes + b.received_bytes) - (a.sent_bytes + a.received_bytes));
    return {
      tv_ip: raw.tv_ip,
      label: label(raw.label) || (legacy ? "Monitor en directo" : "Captura"),
      updated_at: label(raw.updated_at) || label(raw.last_outbound_utc) || "",
      duration_seconds: positiveNumber(raw.seconds) || (
        raw.first_outbound_utc && raw.last_outbound_utc ?
        Math.max(0, (Date.parse(raw.last_outbound_utc) - Date.parse(raw.first_outbound_utc)) / 1000) : 0),
      destinations,
      totals: {
        packets: destinations.reduce((s, d) => s + d.packets, 0),
        sent: destinations.reduce((s, d) => s + d.sent_bytes, 0),
        received: destinations.reduce((s, d) => s + d.received_bytes, 0)
      },
      source: legacy ? "tv_monitor" : "tshark_capture",
      dns_queries: uniqueList(raw.dns_queries),
      note: label(raw.note) || "Metadatos observados, no contenido de audio ni datos cifrados."
    };
  }
  function compareReports(before, after) {
    if (before.tv_ip !== after.tv_ip) throw Error("La IP de TV no coincide entre los dos informes.");
    const a = new Map(before.destinations.map(d => [d.ip, d]));
    const b = new Map(after.destinations.map(d => [d.ip, d]));
    const newIps = [...b.keys()].filter(ip => !a.has(ip));
    const absentIps = [...a.keys()].filter(ip => !b.has(ip));
    return {
      newIps, absentIps,
      sharedIps: [...a.keys()].filter(ip => b.has(ip)).length,
      sentDelta: after.totals.sent - before.totals.sent,
      receivedDelta: after.totals.received - before.totals.received,
      packetsDelta: after.totals.packets - before.totals.packets,
      comparableDuration: before.duration_seconds > 0 && after.duration_seconds > 0 &&
        Math.abs(before.duration_seconds - after.duration_seconds) < 10,
      beforeDuration: before.duration_seconds,
      afterDuration: after.duration_seconds
    };
  }
  function csvExport(report) {
    const esc = val => {
      let s = String(val == null ? "" : val);
      // Prevent spreadsheet formula injection when the CSV is later opened.
      if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const rows = [["IP", "Dominios visibles", "Puertos", "Bytes enviados (tramas)",
      "Bytes recibidos (tramas)", "Paquetes"]];
    for (const d of report.destinations) rows.push([d.ip, d.domains.join(" | "),
      d.ports.join(" | "), d.sent_bytes, d.received_bytes, d.packets]);
    return "\uFEFF" + rows.map(row => row.map(esc).join(",")).join("\r\n") + "\r\n";
  }
  return { normalizeReport, compareReports, csvExport };
});
