import type { CapturedApplication } from "@/messages";

/** Saves the held application as a reviewable JSON file. */
export function downloadCapture(app: CapturedApplication): void {
  const id = app.normalized["application"]?.["id"];
  const safeId = typeof id === "string" && id
    ? id.replace(/[^a-z0-9_-]/gi, "-")
    : new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([JSON.stringify(app, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `captured-application-${safeId}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
