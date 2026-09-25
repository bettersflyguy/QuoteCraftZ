/* Generic insured-data harvester, injected on demand into a carrier page the
 * user granted (the inverse of portal-fill.js). Reads what is VISIBLE on the
 * current page only — form controls, yes/no groups, definition lists, two-cell
 * tables and review rows. Never navigates, clicks, saves or submits, and never
 * reads passwords, files, cookies, storage or network traffic. Normalization
 * and merging happen in the extension worker, not here. */
(function () {
  "use strict";

  if (globalThis.__bettersPortalIngestLoaded) return;
  globalThis.__bettersPortalIngestLoaded = true;

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || element.closest("[hidden], [aria-hidden='true']")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function text(element) {
    return clean(element && (element.innerText || element.textContent));
  }

  function labelledText(element) {
    const labelledBy = clean(element && element.getAttribute("aria-labelledby"));
    if (!labelledBy) return "";
    return labelledBy.split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean).map(text).filter(Boolean).join(" ");
  }

  function labelFor(control) {
    const aria = control.getAttribute("aria-label") || control.getAttribute("data-label");
    if (aria) return aria;
    if (control.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      if (explicit) return text(explicit);
    }
    if (control.labels && control.labels.length) {
      const labels = Array.from(control.labels).map(text).filter(Boolean);
      if (labels.length) return labels.join(" ");
    }
    const wrapping = control.closest("label");
    if (wrapping) return text(wrapping).replace(clean(control.value), "").trim();
    const fromLabelledBy = labelledText(control);
    if (fromLabelledBy) return fromLabelledBy;
    const fieldset = control.closest("fieldset");
    const legend = fieldset && fieldset.querySelector(":scope > legend");
    if (legend) return text(legend);
    return control.getAttribute("placeholder") || control.name || control.id || "";
  }

  function optionName(control) {
    const aria = control.getAttribute("aria-label");
    if (aria) return aria;
    const wrapping = control.closest("label");
    return clean(text(wrapping) || control.value);
  }

  function valueFor(control) {
    const type = (control.getAttribute("type") || "").toLowerCase();
    const role = (control.getAttribute("role") || "").toLowerCase();
    if (["password", "file", "hidden"].includes(type)) return "";
    if (type === "checkbox" || role === "checkbox" || role === "switch") {
      return control.checked === true || control.getAttribute("aria-checked") === "true" ? "Yes" : "No";
    }
    if (type === "radio" || role === "radio") {
      return control.checked === true || control.getAttribute("aria-checked") === "true" ? optionName(control) : "";
    }
    if (control.tagName === "SELECT") {
      return Array.from(control.selectedOptions).map((option) => text(option)).filter(Boolean).join(", ");
    }
    if (role === "combobox") {
      return clean(control.getAttribute("data-value") || text(control));
    }
    return clean(control.value || control.getAttribute("value"));
  }

  function pageSection() {
    const heading = document.querySelector("main h1, main h2, h1, h2");
    return text(heading) || location.hostname;
  }

  function collect() {
    const section = pageSection();
    const root = document.querySelector("main") || document;
    const fields = [];

    Array.from(root.querySelectorAll("input, select, textarea, [role='combobox'], [role='checkbox'], [role='switch']"))
      .filter(isVisible)
      .filter((control) => !["radio", "hidden", "password", "file", "submit", "button", "reset", "search"].includes((control.getAttribute("type") || "").toLowerCase()))
      .forEach((control) => {
        fields.push({ label: clean(labelFor(control)), value: valueFor(control), name: clean(control.name || control.id), section, group: "", source: "control" });
      });

    Array.from(root.querySelectorAll("fieldset"))
      .filter(isVisible).filter((fieldset) => !fieldset.querySelector("fieldset"))
      .forEach((fieldset) => {
        const legend = fieldset.querySelector(":scope > legend") || fieldset.querySelector("legend");
        const choices = Array.from(fieldset.querySelectorAll("[role='radio'], input[type='radio']"));
        const selected = choices.find((choice) => choice.checked === true || choice.getAttribute("aria-checked") === "true");
        if (legend && selected) fields.push({ label: text(legend), value: optionName(selected), section, group: "", source: "choice-group" });
      });

    Array.from(root.querySelectorAll("dt")).filter(isVisible).forEach((term) => {
      const value = term.nextElementSibling && term.nextElementSibling.matches("dd") ? term.nextElementSibling : null;
      if (value) fields.push({ label: text(term), value: text(value), section, group: "", source: "definition-list" });
    });

    root.querySelectorAll("tr").forEach((row) => {
      if (!isVisible(row)) return;
      const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td")).map(text).filter(Boolean);
      if (cells.length === 2 && cells[0] !== cells[1]) {
        fields.push({ label: cells[0], value: cells[1], section, group: "", source: "table" });
      }
    });

    const selectors = ["[class*='summary'] [class*='row']", "[class*='review'] [class*='row']", "[class*='detail'] [class*='row']"];
    root.querySelectorAll(selectors.join(",")).forEach((row) => {
      if (!isVisible(row) || row.querySelector("input, select, textarea, [role='combobox'], [role='radiogroup']")) return;
      const children = Array.from(row.children).map(text).filter(Boolean);
      if (children.length === 2 && children[0].length < 180 && children[1].length < 1000) {
        fields.push({ label: children[0], value: children[1], section, group: "", source: "review-row" });
      }
    });

    return fields.filter((field) => field.label && field.value);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "INGEST_PAGE") return;
    try {
      sendResponse({ ok: true, fields: collect(), title: document.title, url: location.href });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  });
})();
