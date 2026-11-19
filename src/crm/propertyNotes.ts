import type { CapturedApplication } from "@/boldpenguin/types";
import type { BatchItemResult, NoteOutcome } from "./dataverse";
import { buildPropertyNote, noteOutcomeText, propertyNoteSlots } from "./appCommit";

/** Resolve notes only to the property this row loaded, never to the account
 * or a different property's record when a row could not be loaded. */
export async function writePropertyNotes(
  app: CapturedApplication,
  loaded: { asset: string; id: string; row: string }[],
  write: (id: string, subject: string, html: string) => Promise<NoteOutcome>
): Promise<BatchItemResult[]> {
  const results: BatchItemResult[] = [];
  for (const slot of propertyNoteSlots(app)) {
    const note = buildPropertyNote(app, slot);
    if (!note) continue;
    const property = loaded.find(a => a.asset === "properties" && a.row === `crm:property${slot}`);
    const label = `Notes for Property ${slot}`;
    if (!property?.id) {
      results.push({ key: label, status: 0, error: "No matching property loaded for this row. Map its address or other property columns first.", entityId: null });
      continue;
    }
    try {
      const outcome = await write(property.id, note.subject, note.html);
      results.push({ key: `${label}: ${noteOutcomeText(outcome)} (${note.count} values)`, status: 204, error: null, entityId: null });
    } catch (e) {
      results.push({ key: label, status: 0, error: String((e as Error).message ?? e), entityId: null });
    }
  }
  return results;
}
