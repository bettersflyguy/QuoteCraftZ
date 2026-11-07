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
    for (let hops = 0; hops < 5 && node.parentElement; hops += 1) {
      node = node.parentElement;
      if (node.matches("form, main, body, section")) break;
      /* prefer an explicit, VISIBLE heading/label in this ancestor */
      for (const h of node.querySelectorAll("legend, label, h1, h2, h3, h4, h5, h6")) {
        if (h.contains(control) || !visible(h) || !h.getClientRects().length) continue;
        const t = clean(h.innerText);
        if (t.length >= 3 && t.length <= 140) return t;
      }
      /* else: the first visible short text that PRECEDES the control (SPA
       * design systems render the question as a plain span/div above the
       * input). Live nodes only - cloned/detached innerText degrades to
       * textContent and picks up hidden svg titles ("Search icon"). */
      for (const el of node.querySelectorAll("span, p, div")) {
        if (el === control || el.contains(control) || !visible(el) || !el.getClientRects().length) continue;
        if (el.closest("button, a, svg")) continue;
        if (!(control.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
        const own = clean(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
        if (own.length >= 3 && own.length <= 140) return own;
      }
    }
    return "";
  }

  /* the one VISIBLE label a human would read for this control */
  function primaryLabel(element) {
    const fieldset = element.closest("fieldset");
    const legend = fieldset && fieldset.querySelector(":scope > legend");
    if ((element.type || "").toLowerCase() === "radio" && legend) {
      return clean(legend.innerText || legend.textContent);
    }
    const wrappingLabel = element.closest("label");
    return clean(element.getAttribute("aria-label")) || labelledText(element) || explicitLabel(element) ||
      clean(wrappingLabel && (wrappingLabel.innerText || wrappingLabel.textContent)) ||
      clean(legend && (legend.innerText || legend.textContent)) || containerLabel(element);
  }

  function fieldName(element) {
    /* one PRIMARY label, in priority order; container text only as a fallback
     * for label-less SPA fields. Concatenating container text onto real labels
     * let payment-widget verbiage ("bank name and address") hijack matches. */
    const parts = [
      primaryLabel(element), element.getAttribute("placeholder"), element.getAttribute("autocomplete"),
      element.name, element.id
    ].map(clean).filter(Boolean);
    return Array.from(new Set(parts)).join(" ");
  }

  /* stable identity for a control, shared by the mapping editor's scan and the
   * fill pass — agent-taught mappings are stored against these keys */
  function controlKey(element) {
    if ((element.type || "").toLowerCase() === "radio") {
      return "radio:" + (clean(element.name) || mapper.canonical(primaryLabel(element)).slice(0, 60));
    }
    const tag = element.tagName === "SELECT" ? "select" : (element.type || "text").toLowerCase();
    const base = clean(element.name) || clean(element.id) || mapper.canonical(primaryLabel(element) || fieldName(element)).slice(0, 60);
    return (tag + ":" + base).slice(0, 120);
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

  const SUGGESTION_SELECTOR = "[role='listbox'] [role='option'], .pac-container .pac-item, [class*='autocomplete'] [role='option'], [class*='autocomplete'] li, [class*='suggestion'] li, [class*='suggestion'] [role='option']";

  /* auto-pick an ADDRESS suggestion only when it corroborates the captured
   * data: it must carry the street number AND the captured ZIP or city (or
   * start with the full typed line). Anything weaker stays focused for the
   * agent to confirm. */
  async function pickAddressSuggestion(element, value, addrCtx) {
    await new Promise((r) => setTimeout(r, 900));
    const items = Array.from(document.querySelectorAll(SUGGESTION_SELECTOR)).filter((o) => o.getClientRects().length);
    if (!items.length) return false;
    const streetNum = (String(value).match(/^\d+/) || [""])[0];
    const cityCanon = mapper.canonical(addrCtx.city || "");
    const zip = clean(addrCtx.zip || "");
    const lineCanon = mapper.canonical(value);
    const target = items.find((o) => {
      const txt = clean(o.innerText);
      const txtCanon = mapper.canonical(txt);
      if (streetNum && !txt.includes(streetNum)) return false;
      return (zip && txt.includes(zip)) || (cityCanon && txtCanon.includes(cityCanon)) || txtCanon.startsWith(lineCanon);
    });
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.click();
    return true;
  }

  /* MUI-style autocompletes (input[role=combobox]) DISCARD synthetic text but
   * open their listbox: type to trigger it, then CLICK the matching option -
   * the same semantics as native select matching. */
  async function fillListCombobox(element, candidate) {
    const value = candidate.value;
    setNativeValue(element, value);
    dispatch(element, value);
    await new Promise((r) => setTimeout(r, 500));
    const options = Array.from(document.querySelectorAll("[role='listbox'] [role='option']"))
      .filter((o) => o.getClientRects().length);
    if (!options.length) return { status: "filled" }; // typed text stays; agent confirms
    const variants = mapper.valueVariants(value).map((v) => mapper.canonical(v));
    const byTier = (tier) => options.find((o) => {
      const label = mapper.canonical(o.innerText);
      return variants.some((w) => tier === 0 ? label === w : tier === 1 ? label.startsWith(w) : label.includes(w));
    });
    const target = byTier(0) || byTier(1) || byTier(2);
    if (!target) return { status: "option-mismatch" };
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.click();
    element.dataset.bettersFilled = "true";
    element.style.outline = "2px solid #1c8a72";
    setTimeout(() => { element.style.outline = ""; }, 5000);
    return { status: "filled" };
  }

  async function fillControl(element, candidate, overwrite, addrCtx, fieldNameHint) {
    const tag = element.tagName;
    const type = (element.type || "").toLowerCase();
    /* an existing value that is INVALID for this field (a phone holding the
     * TYPE like "Cell") does not count as filled — replace it */
    if (!overwrite && !blank(element) && mapper.validForField(fieldNameHint || "", element.value)) return { status: "existing" };

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
      const variants = mapper.valueVariants(candidate.value).map((v) => mapper.canonical(v));
      const option = Array.from(element.options).find((item) => {
        const label = mapper.canonical(item.textContent);
        const value = mapper.canonical(item.value);
        return variants.some((wanted) => label === wanted || value === wanted || label.includes(wanted) || wanted.includes(label));
      });
      if (!option) return { status: "option-mismatch" };
      element.value = option.value;
      dispatch(element);
      return { status: "filled" };
    }
    if (element.getAttribute("role") === "combobox" || element.getAttribute("aria-autocomplete") === "list") {
      if (candidate.path === "address.street1" || candidate.path === "address.street2") {
        setNativeValue(element, candidate.value);
        dispatch(element, candidate.value);
        await pickAddressSuggestion(element, candidate.value, addrCtx || {});
        return { status: "filled" };
      }
      return fillListCombobox(element, candidate);
    }
    const value = type === "date" ? dateValue(candidate.value) : candidate.value;
    setNativeValue(element, value);
    dispatch(element, value);
    if (isSuggestive(element) && (candidate.path === "address.street1" || candidate.path === "address.street2")) {
      await pickAddressSuggestion(element, value, addrCtx || {});
    }
    return { status: "filled" };
  }

  /* an OPEN MODAL owns the page: reading (or filling) behind it mixes OTHER
   * records - e.g. Tivly's whole lead list behind its Lead Details dialog */
  function activeModal() {
    const junk = /qsi|qualtrics|intercom|drift|zendesk|launcher|chat|feedback|survey|beacon|usabilla|hotjar|walkme|pendo/i;
    const candidates = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], [class*='modal']"))
      .filter((el) => visible(el) && el.getClientRects().length &&
        !/backdrop|overlay/i.test(String(el.className)) &&
        !junk.test(String(el.className) + " " + String(el.id)));
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const el = candidates[i];
      const r = el.getBoundingClientRect();
      if (r.width < 240 || r.height < 120 || r.width * r.height < innerWidth * innerHeight * 0.06) continue;
      /* a dialog only OWNS the page when it has real content: a survey/chat
       * widget passing the size bar must not hijack capture or fill */
      const hasControls = el.querySelector("input, select, textarea");
      const textLength = String(el.innerText || "").replace(/\s+/g, " ").trim().length;
      if (hasControls || textLength >= 120) return el;
    }
    return null;
  }

  function pageControls(fillRoot) {
    return Array.from(fillRoot.querySelectorAll("input, select, textarea"))
      .filter(visible)
      .filter((element) => !element.disabled && !element.readOnly)
      .filter((element) => !["hidden", "password", "file", "submit", "button", "reset"].includes((element.type || "").toLowerCase()));
  }

  /* the candidate an agent-taught mapping points at: a normalized rule path,
   * or "label:<canonical captured label>" — the label form reaches ANY held
   * field (2nd driver, vehicle 2 VIN, garaging address...), explicit user
   * intent bypassing the generic-label drop */
  function overrideCandidate(overrides, key, candidates, payloadFields) {
    const path = overrides[key];
    if (!path || path === "skip") return null;
    if (path.indexOf("label:") === 0) {
      const wanted = path.slice(6);
      const field = (payloadFields || []).find((f) => mapper.canonical(f.label) === wanted && clean(f.value));
      return field ? { path, value: clean(field.value) } : null;
    }
    return candidates.find((c) => c.path === path) || null;
  }

  async function fill(payload, overwrite, autoAdvance, overrides) {
    const ov = overrides || {};
    const candidates = mapper.buildCandidates(payload);
    const fillRoot = activeModal() || document;
    const controls = pageControls(fillRoot);
    const addrCtx = {
      city: (candidates.find((c) => c.path === "address.city") || {}).value || "",
      zip: (candidates.find((c) => c.path === "address.postalCode") || {}).value || "",
      street: (candidates.find((c) => c.path === "address.street1") || {}).value || ""
    };
    const results = [];
    const handledRadioGroups = new Set();

    for (const element of controls) {
      const name = fieldName(element);
      if (!name || PAYMENT_FIELD.test(name)) continue;
      if (element.type === "radio") {
        const fieldset = element.closest("fieldset");
        const groupKey = element.name ? `name:${element.name}` : fieldset || element;
        if (handledRadioGroups.has(groupKey)) continue;
        handledRadioGroups.add(groupKey);
        const mapKey = controlKey(element);
        if (ov[mapKey] === "skip") continue;
        const candidate = overrideCandidate(ov, mapKey, candidates, payload && payload.fields) || (ov[mapKey] ? null : mapper.matchField(name, candidates));
        if (!candidate) continue;
        const group = controls.filter((control) => control.type === "radio" && (element.name ? control.name === element.name : control.closest("fieldset") === fieldset));
        const target = group.find((control) => mapper.canonical(optionName(control)) === mapper.canonical(candidate.value));
        if (!target) { results.push({ label: name, status: "option-mismatch" }); continue; }
        const outcome = await fillControl(target, candidate, overwrite, addrCtx, name);
        results.push({ label: name, path: candidate.path, status: outcome.status });
        continue;
      }
      const mapKey = controlKey(element);
      if (ov[mapKey] === "skip") continue;
      const candidate = overrideCandidate(ov, mapKey, candidates, payload && payload.fields) || (ov[mapKey] ? null : mapper.matchField(name, candidates));
      if (!candidate) continue;
      const outcome = await fillControl(element, candidate, overwrite, addrCtx, name);
      results.push({ label: name, path: candidate.path, status: outcome.status });
    }

    /* address-verification dialogs ("We found an alternate address ... Select
     * address"): confirm ONLY when the dialog's suggested address carries the
     * captured street number AND the captured ZIP or city — a value
     * confirmation, not blind navigation. */
    try {
      await new Promise((r) => setTimeout(r, 1200));
      const confirmBtn = Array.from(document.querySelectorAll("button, [role='button']")).find((b) => {
        if (!b.getClientRects().length) return false;
        return /^(select|use|confirm)( this| suggested| verified)? address$/.test(mapper.canonical(b.innerText));
      });
      if (confirmBtn) {
        let node = confirmBtn, ctx = "";
        for (let i = 0; i < 6 && node.parentElement; i += 1) {
          node = node.parentElement;
          const t = clean(node.innerText);
          if (t.length > 30) { ctx = t; break; }
        }
        const streetNum = (String(addrCtx.street).match(/^\d+/) || [""])[0];
        const ctxCanon = mapper.canonical(ctx);
        const cityCanon = mapper.canonical(addrCtx.city);
        const corroborated = Boolean(streetNum) && ctx.includes(streetNum) &&
          ((addrCtx.zip && ctx.includes(addrCtx.zip)) || (cityCanon && ctxCanon.includes(cityCanon)));
        if (corroborated) {
          confirmBtn.click();
          results.push({ label: "Address confirmation (" + clean(confirmBtn.innerText) + ")", path: "address.street1", status: "filled" });
        }
      }
    } catch (_e) { /* no dialog - nothing to confirm */ }

    /* SUPERVISED ADVANCE (opt-in): when no visible required field is left
     * blank, click the page's plain continue button. Allowlist verbs only -
     * never submit/purchase/bind/pay/rate; the agent watches the tab. */
    if (autoAdvance) {
      try {
        await new Promise((r) => setTimeout(r, 400));
        const requiredBlank = Array.from(fillRoot.querySelectorAll("input, select, textarea"))
          .filter((el) => visible(el) && !el.disabled && (el.required || el.getAttribute("aria-required") === "true"))
          .some((el) => blank(el));
        if (!requiredBlank) {
          const STOP = /submit|purchase|bind|pay|checkout|finalize|order|agree|buy|rate/i;
          const target = Array.from(fillRoot.querySelectorAll("button, [role='button'], input[type='submit']"))
            .filter((b) => b.getClientRects().length && !b.disabled)
            .find((b) => {
              const t = clean(b.innerText || b.value || "");
              return /^(next|continue|start quote|save and continue|save & continue)$/i.test(t) && !STOP.test(t);
            });
          if (target) {
            target.click();
            results.push({ label: "Advanced: " + clean(target.innerText || target.value || "button"), path: "advance", status: "filled" });
          }
        }
      } catch (_e) { /* best effort */ }
    }

    const filled = results.filter((result) => result.status === "filled");
    return {
      filledCount: filled.length,
      existingCount: results.filter((result) => result.status === "existing").length,
      optionMismatchCount: results.filter((result) => result.status === "option-mismatch").length,
      controlCount: controls.length,
      filled: filled.map(({ label, path }) => ({ label, path }))
    };
  }

  /* mapping editor's view of this frame: every fillable control with its key,
   * visible label, what auto-matching would pick, and any saved mapping */
  function scanControls(payload, overrides) {
    const ov = overrides || {};
    const candidates = payload ? mapper.buildCandidates(payload) : [];
    const rows = [];
    const seen = new Set();
    for (const element of pageControls(activeModal() || document)) {
      const name = fieldName(element);
      if (!name) continue;
      const key = controlKey(element);
      if (seen.has(key)) continue;
      seen.add(key);
      const payment = PAYMENT_FIELD.test(name);
      const auto = payment || !candidates.length ? null : mapper.matchField(name, candidates);
      const autoPath = auto && typeof auto.path === "string" && auto.path.indexOf("fields.") !== 0 ? auto.path : null;
      rows.push({
        key,
        label: primaryLabel(element) || clean(element.getAttribute("placeholder")) || clean(element.name) || clean(element.id) || key,
        type: element.tagName === "SELECT" ? "select" : (element.type || "text").toLowerCase(),
        payment,
        autoPath,
        mapped: typeof ov[key] === "string" ? ov[key] : null
      });
    }
    return rows;
  }

  /* invoked per frame by the worker via chrome.scripting.executeScript func —
   * each frame (agent portals often put the form in an iframe) fills its own
   * fields and returns its own counts for the worker to aggregate */
  globalThis.__bettersPortalFill = (payload, overwrite, autoAdvance, overrides) => fill(payload, Boolean(overwrite), Boolean(autoAdvance), overrides || {});
  globalThis.__bettersPortalScan = (payload, overrides) => scanControls(payload, overrides || {});
})();
