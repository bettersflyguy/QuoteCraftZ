import type { CapturedApplication } from "@/messages";

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Exports the held application as a CSV that opens cleanly in Excel
 * (BOM for UTF-8, one row per captured field). */
export function exportCaptureToExcel(app: CapturedApplication): void {
  const rows = [
    ["Section", "Group", "Field", "Value"],
    ...app.fields.map(f => [f.section, f.group, f.label, f.value])
  ];
  const csv = "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
  const id = app.normalized["application"]?.["id"];
  const safeId = typeof id === "string" && id
    ? id.replace(/[^a-z0-9_-]/gi, "-")
    : new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `captured-application-${safeId}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
