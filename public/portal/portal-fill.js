(function () {
  "use strict";

  if (globalThis.__bettersPortalFillerLoaded) return;
  globalThis.__bettersPortalFillerLoaded = true;

  const mapper = globalThis.BettersPortalMapper;

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function visible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function labelledText(element) {
    const ids = clean(element.getAttribute("aria-labelledby")).split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)).filter(Boolean).map((node) => clean(node.innerText || node.textContent)).join(" ");
  }

  function explicitLabel(element) {
    if (!element.id) return "";
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    return clean(label && (label.innerText || label.textContent));
  }

  /* SPA portals (e.g. GEICO's quote workspace) put the visible label in an
   * ancestor container instead of label[for]/aria — mirror the harvester's
   * fallback so those fields are matchable too. */
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

  function fieldName(element) {
    const fieldset = element.closest("fieldset");
    const legend = fieldset && fieldset.querySelector(":scope > legend");
    if ((element.type || "").toLowerCase() === "radio" && legend) {
      return clean(legend.innerText || legend.textContent);
    }
    /* one PRIMARY label, in priority order; container text only as a fallback
     * for label-less SPA fields. Concatenating container text onto real labels
     * let payment-widget verbiage ("bank name and address") hijack matches. */
    const primary = clean(element.getAttribute("aria-label")) || labelledText(element) || explicitLabel(element) ||
      clean(legend && (legend.innerText || legend.textContent)) || containerLabel(element);
    const parts = [
      primary, element.getAttribute("placeholder"), element.getAttribute("autocomplete"),
      element.name, element.id
    ].map(clean).filter(Boolean);
    return Array.from(new Set(parts)).join(" ");
  }

  /* banking, payment and card fields are NEVER auto-filled — an insurance
   * application holds nothing that belongs in them */
  const PAYMENT_FIELD = /\b(bank|routing|account\s*(no|num|number)|iban|swift|card\s*(no|num|number)?|credit\s*card|debit|cvv|cvc|billing|payment|pay\s*method|method\s*of\s*payment|pay\s*plan|auto\s*pay|autopay|amount\s*due|paid\s*to\s*date|balance|eft|ach)\b/i;

  function optionName(element) {
    const label = explicitLabel(element) || clean(element.getAttribute("aria-label"));
    const wrapping = element.closest("label");
    return label || clean(wrapping && (wrapping.innerText || wrapping.textContent)) || clean(element.value);
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value") && Object.getOwnPropertyDescriptor(prototype, "value").set;
    if (setter) setter.call(element, value);
    else element.value = value;
  }

  function dateValue(value) {
    const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return value;
    return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }

  /* address autocompletes ("Begin typing an address...") DISCARD programmatic
   * values on blur unless a suggestion is chosen - leave those focused with
   * the text typed so the agent confirms with one click */
  function isSuggestive(element) {
    return Boolean(
      element.getAttribute("aria-autocomplete") === "list" ||
      element.closest("[role='combobox']") ||
      /begin typing|start typing/i.test(element.getAttribute("placeholder") || "")
    );
  }

  function dispatch(element, typed) {
    if (typed) {
      element.focus();
      element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: String(typed).slice(-1) }));
      try {
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(typed) }));
      } catch (_e) {
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
      element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: String(typed).slice(-1) }));
    } else {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    if (!typed || !isSuggestive(element)) element.dispatchEvent(new Event("blur", { bubbles: true }));
    element.dataset.bettersFilled = "true";
    element.style.outline = "2px solid #1c8a72";
    element.style.outlineOffset = "2px";
    setTimeout(() => {
      element.style.outline = "";
      element.style.outlineOffset = "";
    }, 5000);
  }

  function blank(element) {
    if (element.type === "checkbox" || element.type === "radio") return !element.checked;
    return !clean(element.value);
  }

  function yes(value) {
    return /^(yes|true|1|checked|selected)$/i.test(clean(value));
  }

  function fillControl(element, candidate, overwrite) {
    const tag = element.tagName;
    const type = (element.type || "").toLowerCase();
    if (!overwrite && !blank(element)) return { status: "existing" };

    if (type === "radio") {
      if (mapper.canonical(optionName(element)) !== mapper.canonical(candidate.value)) return { status: "option-mismatch" };
      if (!element.checked) element.click();
      dispatch(element);
      return { status: "filled" };
    }
    if (type === "checkbox") {
      const desired = yes(candidate.value);
      if (element.checked !== desired) element.click();
      dispatch(element);
      return { status: "filled" };
    }
    if (tag === "SELECT") {
      const wanted = mapper.canonical(candidate.value);
      const option = Array.from(element.options).find((item) => {
        const label = mapper.canonical(item.textContent);
        const value = mapper.canonical(item.value);
        return label === wanted || value === wanted || label.includes(wanted) || wanted.includes(label);
      });
      if (!option) return { status: "option-mismatch" };
      element.value = option.value;
      dispatch(element);
      return { status: "filled" };
    }
    const value = type === "date" ? dateValue(candidate.value) : candidate.value;
    setNativeValue(element, value);
    dispatch(element, value);
    return { status: "filled" };
  }

  function fill(payload, overwrite) {
    const candidates = mapper.buildCandidates(payload);
    const controls = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter(visible)
      .filter((element) => !element.disabled && !element.readOnly)
      .filter((element) => !["hidden", "password", "file", "submit", "button", "reset"].includes((element.type || "").toLowerCase()));
    const results = [];
    const handledRadioGroups = new Set();

    controls.forEach((element) => {
      const name = fieldName(element);
      if (!name || PAYMENT_FIELD.test(name)) return;
      if (element.type === "radio") {
        const fieldset = element.closest("fieldset");
        const groupKey = element.name ? `name:${element.name}` : fieldset || element;
        if (handledRadioGroups.has(groupKey)) return;
        handledRadioGroups.add(groupKey);
        const candidate = mapper.matchField(name, candidates);
        if (!candidate) return;
        const group = controls.filter((control) => control.type === "radio" && (element.name ? control.name === element.name : control.closest("fieldset") === fieldset));
        const target = group.find((control) => mapper.canonical(optionName(control)) === mapper.canonical(candidate.value));
        if (!target) return results.push({ label: name, status: "option-mismatch" });
        const outcome = fillControl(target, candidate, overwrite);
        return results.push({ label: name, path: candidate.path, status: outcome.status });
      }
      const candidate = mapper.matchField(name, candidates);
      if (!candidate) return;
      const outcome = fillControl(element, candidate, overwrite);
      results.push({ label: name, path: candidate.path, status: outcome.status });
    });

    const filled = results.filter((result) => result.status === "filled");
    return {
      filledCount: filled.length,
      existingCount: results.filter((result) => result.status === "existing").length,
      optionMismatchCount: results.filter((result) => result.status === "option-mismatch").length,
      controlCount: controls.length,
      filled: filled.map(({ label, path }) => ({ label, path }))
    };
  }

  /* invoked per frame by the worker via chrome.scripting.executeScript func —
   * each frame (agent portals often put the form in an iframe) fills its own
   * fields and returns its own counts for the worker to aggregate */
  globalThis.__bettersPortalFill = (payload, overwrite) => fill(payload, Boolean(overwrite));
})();
