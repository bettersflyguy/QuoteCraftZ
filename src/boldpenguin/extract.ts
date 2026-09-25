/** Bold Penguin application capture — content script on *.boldpenguin.com.
 * TypeScript port of the Application Assistant concept's content/extract.js.
 *
 * Walks the question-set navigation of a completed application, reads native
 * and Angular form controls, yes/no groups, definition lists, tables, entity
 * cards and review rows, opens each vehicle editor for VINs, then restores the
 * original section. Read-only: never saves, never clicks Next/Submit, never
 * reads passwords/files/cookies/storage/network. */
import { clean, canonical, normalize } from "./normalize";
import type { CapturedAppField, CapturedApplication } from "./types";

const MAX_SECTIONS = 40;
const SKIP_SECTIONS = new Set(["Review Quotes"]);

type Field = CapturedAppField;

function isVisible(element: Element | null): boolean {
  if (!element || element.closest("[hidden], [aria-hidden='true']")) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function text(element: Element | null | undefined): string {
  const el = element as HTMLElement | null | undefined;
  return clean(el && (el.innerText || el.textContent));
}

function labelledText(element: Element | null): string {
  const labelledBy = clean(element && element.getAttribute("aria-labelledby"));
  if (!labelledBy) return "";
  return labelledBy.split(/\s+/)
    .map(id => document.getElementById(id))
    .filter((n): n is HTMLElement => Boolean(n)).map(text).filter(Boolean).join(" ");
}

function accessibleName(element: Element | null | undefined): string {
  if (!element) return "";
  return clean(element.getAttribute("aria-label") || labelledText(element) || text(element));
}

function cleanSectionName(value: unknown): string {
  return clean(value).replace(/^\d+\s+/, "").replace(/\s+(SHOW|HIDE|EDIT)$/i, "").trim();
}

function currentSection(): string {
  return cleanSectionName(text(document.querySelector("main h2[aria-current], main h2:focus, main h2")) || "Application");
}

function groupFor(element: Element): string {
  const region = element.closest("[role='region']");
  if (region) {
    const name = cleanSectionName(accessibleName(region));
    if (name && name.length < 180) return name;
  }
  const panel = element.closest("mat-expansion-panel, [class*='expansion-panel']");
  if (panel) {
    const header = panel.querySelector("mat-expansion-panel-header, [aria-expanded]");
    const name = cleanSectionName(accessibleName(header));
    if (name && name.length < 180) return name;
  }
  return "";
}

function labelFor(control: Element): string {
  const aria = control.getAttribute("aria-label") || control.getAttribute("data-label");
  if (aria && !/^toggle choices$/i.test(aria)) return aria;
  if (control.id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
    if (explicit) return text(explicit);
  }
  const labels = (control as HTMLInputElement).labels;
  if (labels && labels.length) {
    const names = Array.from(labels).map(text).filter(Boolean);
    if (names.length) return names.join(" ");
  }
  const wrapping = control.closest("label");
  if (wrapping) return text(wrapping).replace(clean((control as HTMLInputElement).value), "").trim();
  const fromLabelledBy = labelledText(control);
  if (fromLabelledBy) return fromLabelledBy;
  const fieldset = control.closest("fieldset");
  const legend = fieldset && fieldset.querySelector(":scope > legend");
  if (legend) return text(legend);
  return control.getAttribute("placeholder") || (control as HTMLInputElement).name || control.id || "Unlabeled field";
}

function optionName(control: Element): string {
  const aria = control.getAttribute("aria-label");
  if (aria) return aria;
  const wrapping = control.closest("label, mat-button-toggle, mat-radio-button");
  return clean(text(wrapping) || (control as HTMLInputElement).value);
}

function valueFor(control: Element): string {
  const input = control as HTMLInputElement;
  const type = (control.getAttribute("type") || "").toLowerCase();
  const role = (control.getAttribute("role") || "").toLowerCase();
  if (["password", "file", "hidden"].includes(type)) return "";
  if (type === "checkbox" || role === "checkbox" || role === "switch") {
    return input.checked === true || control.getAttribute("aria-checked") === "true" ? "Yes" : "No";
  }
  if (type === "radio" || role === "radio") {
    return input.checked === true || control.getAttribute("aria-checked") === "true" ? optionName(control) : "";
  }
  if (control.tagName === "SELECT") {
    return Array.from((control as HTMLSelectElement).selectedOptions).map(option => text(option)).filter(Boolean).join(", ");
  }
  if (role === "combobox" || control.tagName === "MAT-SELECT") {
    return clean(control.getAttribute("data-value") || text(control));
  }
  return clean(input.value || control.getAttribute("value"));
}

function collectControls(section: string): Field[] {
  const root = document.querySelector("main") || document;
  const selector = "input, select, textarea, [role='combobox'], [role='checkbox'], [role='switch']";
  return Array.from(root.querySelectorAll(selector))
    .filter((control, index, controls) => controls.indexOf(control) === index)
    .filter(isVisible)
    .filter(control => !["radio", "hidden", "password", "file"].includes((control.getAttribute("type") || "").toLowerCase()))
    .map((control): Field => ({
      label: clean(labelFor(control)), value: valueFor(control),
      name: clean((control as HTMLInputElement).name || control.id), section,
      group: groupFor(control), source: "control"
    }))
    .filter(field => field.value && field.label);
}

function collectChoiceGroups(section: string): Field[] {
  const root = document.querySelector("main") || document;
  return Array.from(root.querySelectorAll("fieldset"))
    .filter(isVisible).filter(fieldset => !fieldset.querySelector("fieldset"))
    .map((fieldset): Field => {
      const legend = fieldset.querySelector(":scope > legend") || fieldset.querySelector("legend");
      const choices = Array.from(fieldset.querySelectorAll("[role='radio'], input[type='radio']"));
      const selected = choices.find(choice =>
        (choice as HTMLInputElement).checked === true || choice.getAttribute("aria-checked") === "true");
      return {
        label: text(legend), value: selected ? optionName(selected) : "",
        section, group: groupFor(fieldset), source: "choice-group"
      };
    })
    .filter(field => field.label && field.value);
}

function collectDefinitionLists(section: string): Field[] {
  const root = document.querySelector("main") || document;
  return Array.from(root.querySelectorAll("dt")).filter(isVisible).map((term): Field | null => {
    const value = term.nextElementSibling && term.nextElementSibling.matches("dd") ? term.nextElementSibling : null;
    return value ? { label: text(term), value: text(value), section, group: groupFor(term), source: "definition-list" } : null;
  }).filter((field): field is Field => Boolean(field && field.label && field.value));
}

function collectTables(section: string): Field[] {
  const root = document.querySelector("main") || document;
  const fields: Field[] = [];
  root.querySelectorAll("tr").forEach(row => {
    if (!isVisible(row)) return;
    const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td")).map(text).filter(Boolean);
    if (cells.length === 2 && cells[0] !== cells[1]) {
      fields.push({ label: cells[0]!, value: cells[1]!, section, group: groupFor(row), source: "table" });
    }
  });
  return fields;
}

function collectReviewRows(section: string): Field[] {
  const root = document.querySelector("main") || document;
  const selectors = ["[class*='summary'] [class*='row']", "[class*='review'] [class*='row']", "[class*='question']", "[data-testid*='question']"];
  const fields: Field[] = [];
  root.querySelectorAll(selectors.join(",")).forEach(row => {
    if (!isVisible(row) || row.querySelector("input, select, textarea, [role='combobox'], [role='radiogroup']")) return;
    const children = Array.from(row.children).map(text).filter(Boolean);
    if (children.length === 2 && children[0]!.length < 180 && children[1]!.length < 1000) {
      fields.push({ label: children[0]!, value: children[1]!, section, group: groupFor(row), source: "review-row" });
    }
  });
  return fields;
}

function collectEntityCards(section: string): Field[] {
  const root = document.querySelector("main") || document;
  return Array.from(root.querySelectorAll("button[aria-expanded]"))
    .filter(isVisible).filter(button => !/summary panel|ineligible carriers/i.test(text(button)))
    .map((button): Field => {
      const heading = button.querySelector("h3") || button.querySelector("[role='heading']");
      return { label: `${section} item`, value: cleanSectionName(text(heading) || text(button)), section, group: "", source: "entity-card" };
    }).filter(field => field.value && field.value.length < 180);
}

function collectPage(section: string): Field[] {
  return [...collectControls(section), ...collectChoiceGroups(section), ...collectDefinitionLists(section),
    ...collectTables(section), ...collectReviewRows(section), ...collectEntityCards(section)];
}

function unique(fields: Field[]): Field[] {
  const seen = new Set<string>();
  return fields.filter(field => {
    field.label = clean(field.label).replace(/[:*]+$/, "").trim();
    field.value = clean(field.value);
    field.section = cleanSectionName(field.section);
    field.group = cleanSectionName(field.group);
    const key = [field.section, field.group, canonical(field.label), field.value].join("|");
    if (!field.label || !field.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function questionNavigation(): HTMLElement | undefined {
  return Array.from(document.querySelectorAll("nav")).find(nav => /question sets/i.test(accessibleName(nav)));
}

function questionButtons(includeReview: boolean): { button: HTMLButtonElement; name: string }[] {
  const navigation = questionNavigation();
  if (!navigation) return [];
  return Array.from(navigation.querySelectorAll("button"))
    .map(button => ({ button, name: cleanSectionName(text(button)) }))
    .filter(item => item.name && (includeReview || !SKIP_SECTIONS.has(item.name)));
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 300));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function expandCoveragePanels(): Promise<void> {
  const root = document.querySelector("main") || document;
  const buttons = Array.from(root.querySelectorAll("[aria-expanded='false']"))
    .filter(isVisible).filter(button => /^configure .+ coverage/i.test(text(button)));
  for (const button of buttons) {
    (button as HTMLElement).click();
    await settle();
  }
}

/** VINs only exist inside Bold Penguin's vehicle editor: open each existing
 * editor, read it, return to the vehicle list without saving. */
async function collectVehicleEditors(section: string): Promise<Field[]> {
  const fields: Field[] = [];
  const findEditButtons = () => Array.from((document.querySelector("main") || document).querySelectorAll("button"))
    .filter(button => /^edit$/i.test(text(button)));
  const vehicleCount = findEditButtons().length;

  for (let index = 0; index < vehicleCount; index += 1) {
    const edit = findEditButtons()[index];
    if (!edit) continue;
    let card: HTMLElement | null = edit.parentElement;
    while (card && !card.querySelector("h3")) card = card.parentElement;
    const vehicleName = text(card && card.querySelector("h3")) || `Vehicle ${index + 1}`;
    edit.click();
    await settle();
    collectPage(section).forEach(field => {
      if (field.source !== "entity-card") fields.push({ ...field, group: field.group || vehicleName });
    });
    const restore = questionButtons(true).find(item => item.name === "Vehicles");
    if (!restore) break;
    restore.button.click();
    await settle();
  }
  return fields;
}

async function scanApplication(): Promise<{ fields: Field[]; sections: string[] }> {
  const original = currentSection();
  const visited = new Set<string>();
  const sections: string[] = [];
  const fields: Field[] = [];
  for (let count = 0; count < MAX_SECTIONS; count += 1) {
    const next = questionButtons(false).find(item => !visited.has(item.name));
    if (!next) break;
    visited.add(next.name);
    next.button.click();
    await settle();
    await expandCoveragePanels();
    const section = currentSection() || next.name;
    sections.push(section);
    fields.push(...collectPage(section));
    if (section === "Vehicles") fields.push(...await collectVehicleEditors(section));
  }
  if (!visited.size) {
    const section = currentSection();
    sections.push(section);
    fields.push(...collectPage(section));
  }
  let restore = questionButtons(true).find(item => item.name === original);
  if (!restore) {
    for (const parentName of ["Eligibility", "Additional details"]) {
      const parent = questionButtons(true).find(item => item.name === parentName);
      if (!parent) continue;
      parent.button.click();
      await settle();
      restore = questionButtons(true).find(item => item.name === original);
      if (restore) break;
    }
  }
  if (restore && currentSection() !== original) {
    restore.button.click();
    await settle();
  }
  return { fields: unique(fields), sections: Array.from(new Set(sections)) };
}

function applicationHeading(): string {
  return Array.from(document.querySelectorAll("main h4, main h5")).map(text).filter(Boolean).join(" • ");
}

function completionEvidence(): CapturedApplication["completion"] {
  const bodyText = canonical((document.body.innerText || "").slice(0, 120000));
  const phrases = ["application complete", "application completed", "submission complete", "successfully submitted", "application summary"];
  const matched = phrases.filter(phrase => bodyText.includes(phrase));
  const hasReviewStep = questionButtons(true).some(item => item.name === "Review Quotes") || /go to quotes/i.test(bodyText);
  return { likelyCompleted: matched.length > 0 || hasReviewStep, matchedPhrases: matched, hasReviewStep };
}

async function capture(): Promise<CapturedApplication> {
  const scan = await scanApplication();
  const heading = applicationHeading();
  const idMatch = heading.match(/\bID:\s*([A-Z0-9-]+)/i);
  const payload: CapturedApplication = {
    schemaVersion: "1.1", capturedAt: new Date().toISOString(),
    source: { system: "Bold Penguin", url: location.href, title: document.title },
    completion: completionEvidence(), scannedSections: scan.sections,
    normalized: normalize(scan.fields), fields: scan.fields
  };
  if (idMatch) {
    const app = (payload.normalized["application"] ??= {});
    app["id"] = app["id"] || idMatch[1]!;
  }
  const selectedLines = scan.fields
    .filter(field => field.section === "Coverage type" && field.value === "Yes")
    .map(field => field.label.replace(/\s+(Eligible Carriers|No coverage available in Terminal).*$/i, "").trim());
  if (selectedLines.length) {
    (payload.normalized["coverage"] ??= {})["lines"] = Array.from(new Set(selectedLines));
  }
  return payload;
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === "bp/getContext") {
    sendResponse({ ok: true, data: { onApplication: Boolean(questionNavigation()), url: location.href } });
    return false;
  }
  if (message?.type !== "bp/capture") return false;
  capture()
    .then(payload => sendResponse({ ok: true, data: payload }))
    .catch((error: Error) => sendResponse({ ok: false, error: error.message || String(error), kind: "unknown" }));
  return true;
});
