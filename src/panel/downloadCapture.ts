import type { CapturedApplication } from "@/messages";
import { buildWorkbook } from "./xlsx";
import { captureSheets } from "./captureSheets";

/** Exports the held capture as an .xlsx workbook: a Summary tab, the
 * captured single values, and every table (Vehicles, Drivers, Policies,
 * taught arrays, timeline notes) on its own tab as a formatted Excel Table. */
export function exportCaptureToExcel(app: CapturedApplication): void {
  const bytes = buildWorkbook(captureSheets(app));
  const who = (app.source.title || app.source.system).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "capture";
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `quotecraftz-${who}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
