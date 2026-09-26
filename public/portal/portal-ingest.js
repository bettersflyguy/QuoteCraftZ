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

  /* SPA portals (GEICO's quote workspace among them) often render the visible
   * label as plain text in an ancestor container instead of wiring label[for]
   * or aria attributes. Walk up a few levels, strip the controls out, and use
   * the container's short text as the label. */
  function containerLabel(control) {
    let node = control;
    for (let hops = 0; hops < 4 && node.parentElement; hops += 1) {
      node = node.parentElement;
      const cloned = node.cloneNode(true);
      cloned.querySelectorAll("select, input, textarea, option, button, [role='listbox']").forEach((x) => x.remove());
      const t = clean(cloned.innerText);
      if (t && t.length >= 3 && t.length <= 180) return t;
      if (t.length > 180) break;
    }
    return "";
  }

  function junkLabel(value) {
    /* auto-generated ids: Id_dcc96de6-039c-..., guid fragments, pure numbers */
    return !value || /^id[_-]/i.test(value) || /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value) || /^[\d_-]+$/.test(value);
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
    const fromContainer = containerLabel(control);
    if (fromContainer) return fromContainer;
    const fallback = control.getAttribute("placeholder") || control.name || control.id || "";
    return junkLabel(fallback) ? "" : fallback;
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

  /* banking, payment and card data is never captured */
  const PAYMENT_FIELD = /\b(bank|routing|account\s*(no|num|number)|iban|swift|card\s*(no|num|number)?|credit\s*card|debit|cvv|cvc|billing|payment|pay\s*plan|autopay|eft|ach)\b/i;

  /* cookie/consent widgets contribute nothing but noise */
  function inConsentUi(element) {
    return Boolean(element.closest("[id*='onetrust'], [class*='onetrust'], [id*='cookie'], [class*='cookie-banner'], [id*='consent'], [aria-label*='consent' i]"));
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
      .filter((control) => !inConsentUi(control))
      .filter((control) => !["radio", "hidden", "password", "file", "submit", "button", "reset", "search"].includes((control.getAttribute("type") || "").toLowerCase()))
      .forEach((control) => {
        const label = clean(labelFor(control));
        if (PAYMENT_FIELD.test(label) || PAYMENT_FIELD.test(clean(control.name || control.id))) return;
        fields.push({ label, value: valueFor(control), name: clean(control.name || control.id), section, group: "", source: "control" });
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

    /* labeled money lines ("6 Month Total Premium: $3,089.50", "Due Today $516.80")
     * — premium summaries usually render as plain text, not form controls */
    root.querySelectorAll("div, li, p, span, dd, td").forEach((el) => {
      if (!isVisible(el) || el.children.length > 3 || inConsentUi(el)) return;
      const t = clean(el.innerText);
      const m = t.match(/^([A-Za-z0-9][A-Za-z0-9 /()&'.-]{2,70}?):?\s*(\$[\d,]+(?:\.\d{2})?)$/);
      if (m && /[A-Za-z]/.test(m[1])) {
        fields.push({ label: m[1], value: m[2], section, group: "", source: "money-line" });
        return;
      }
      /* reversed "amount label" form ("$516.80 Due Today") — short labels only,
       * so trailing button text ("Print Quote Proposal Next") doesn't ride along */
      const r = t.match(/^(\$[\d,]+(?:\.\d{2})?)\s+([A-Za-z][A-Za-z0-9 /()&'.-]{2,30})$/);
      if (r && r[2].split(" ").length <= 3) fields.push({ label: r[2], value: r[1], section, group: "", source: "money-line" });
    });

    /* bold-label prose runs — "<strong>Name Insured</strong> <span>Edward
     * Parkin</span> <br> <strong>Mailing Address</strong>…" — the standard
     * carrier policy-details pattern (GEICO renders the whole block as one
     * <p> with many strong/span/br children). Each strong starts a pair; the
     * value is everything until the next strong or a line break. */
    root.querySelectorAll("p, div, li").forEach((el) => {
      if (!isVisible(el) || inConsentUi(el)) return;
      const strongs = el.querySelectorAll(":scope > strong, :scope > b");
      strongs.forEach((sEl) => {
        const label = clean(sEl.innerText).replace(/[:*]+$/, "");
        if (!label || label.length > 80) return;
        let value = "";
        for (let n = sEl.nextSibling; n; n = n.nextSibling) {
          if (n.nodeType === 1) {
            if (/^(STRONG|B)$/.test(n.tagName)) break;
            if (n.tagName === "BR") { if (value.trim()) break; else continue; }
            value += " " + (n.innerText || "");
          } else if (n.nodeType === 3) {
            value += " " + n.textContent;
          }
        }
        value = clean(value);
        if (value && value.length <= 300 && !PAYMENT_FIELD.test(label)) {
          fields.push({ label, value, section, group: "", source: "review-row" });
        }
      });
    });

    /* sale/confirmation facts are usually PROSE, not form fields ("GEICO Auto
     * Policy Number: 6277201270", "Your coverage is effective 9/27/2026",
     * "Your 6 Month Auto Premium is $922.00") — pattern-match the page text */
    const bodyText = clean((document.body.innerText || "").slice(0, 150000));
    const saleSeen = new Set();
    const salePush = (label, value) => {
      if (value && !saleSeen.has(label)) { saleSeen.add(label); fields.push({ label, value: clean(value), section, group: "", source: "sale" }); }
    };
    const pol = bodyText.match(/policy\s*(?:number|#)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,19})/i);
    if (pol) salePush("Policy Number", pol[1]);
    /* "Effective Dates 9/27/2026-03/27/2027" carries BOTH dates */
    const range = bodyText.match(/effective\s*dates?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (range) {
      salePush("Effective Date", range[1]);
      salePush("Expiration Date", range[2]);
    }
    const eff = bodyText.match(/(?:coverage is\s+)?effective(?:\s*date)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (eff) salePush("Effective Date", eff[1]);
    const exp = bodyText.match(/expiration(?:\s*date)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (exp) salePush("Expiration Date", exp[1]);
    const termPrem = bodyText.match(/(\d{1,2})\s*[- ]?month[^$.]{0,40}?premium[^$]{0,15}\$\s*([\d,]+(?:\.\d{2})?)/i);
    if (termPrem) {
      salePush("Total Premium", "$" + termPrem[2]);
      salePush("Policy Term", termPrem[1] + " months");
    } else {
      const prem = bodyText.match(/total\s+premium\s*:?\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
      if (prem) salePush("Total Premium", "$" + prem[1]);
    }

    /* vehicles ("2000 Chevrolet Suburban xxxxxxxxxxxxx7277") and drivers
     * ("Edward Parkin License number : XXXXXXXXX9522") from covered lists */
    let vi = 0;
    for (const m of bodyText.matchAll(/\b((?:19|20)\d{2}\s+[A-Z][A-Za-z-]+(?:\s+[A-Za-z0-9-]+){1,3}?)\s+[xX*]{4,}(\w{4})/g)) {
      vi += 1;
      if (vi > 6) break;
      salePush(`Vehicle ${vi}`, `${m[1]} (...${m[2]})`);
    }
    let di = 0;
    for (const m of bodyText.matchAll(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)\s+License number\s*:?\s*[xX*]{4,}\w{2,6}/g)) {
      di += 1;
      if (di > 6) break;
      salePush(`Driver ${di}`, m[1]);
    }

    return fields.filter((field) => field.label && field.value);
  }

  /* invoked per frame by the worker via chrome.scripting.executeScript func —
   * fields from every frame are aggregated worker-side */
  globalThis.__bettersPortalIngest = () => ({ fields: collect(), title: document.title, url: location.href });
})();
