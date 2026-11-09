(function () {
  "use strict";

  if (globalThis.__bettersPortalFillerLoaded) return;
  globalThis.__bettersPortalFillerLoaded = true;
  /* a fresh copy (after an extension update) clears whatever an orphaned
   * earlier copy left highlighted */
  setTimeout(function () { if (typeof sweepStalePeek === "function") sweepStalePeek(); }, 0);

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
   * ancestor container instead of label[for]/aria - mirror the harvester's
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
   * fill pass - agent-taught mappings are stored against these keys */
  /* a sub-section's controls share names with their twins ("address1" in
   * Primary and Other Address), so the section rides on the key */
  function sectionSuffix(element) {
    const s = mapper && mapper.sectionOf ? mapper.sectionOf(element).key : "";
    return s ? "@" + s : "";
  }
  function controlKey(element) {
    if ((element.type || "").toLowerCase() === "radio") {
      return "radio:" + (clean(element.name) || mapper.canonical(primaryLabel(element)).slice(0, 60)) + sectionSuffix(element);
    }
    const tag = element.tagName === "SELECT" ? "select" : (element.type || "text").toLowerCase();
    const base = clean(element.name) || clean(element.id) || mapper.canonical(primaryLabel(element) || fieldName(element)).slice(0, 60);
    return (tag + ":" + base).slice(0, 120) + sectionSuffix(element);
  }
  /* "Other Address: City" for a sub-section's field, else the label */
  function inSection(element, label) {
    const s = mapper && mapper.sectionOf ? mapper.sectionOf(element) : null;
    return s && s.text && label ? s.text + ": " + label : label;
  }
  const FIELD_KEY_RE = /^field:(?:([a-z0-9 ]{1,40})\|)?((?:[a-z0-9 ]{1,40}>)?[a-z0-9 ]{1,80})$/;

  /* banking, payment and card fields are NEVER auto-filled - an insurance
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
    const match = clean(value).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
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
     * TYPE like "Cell") does not count as filled - replace it */
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

  const SENSITIVE_SOURCE = /(?<![a-z])(ssns?|ss ?num(ber)?|soc(ial)? ?sec(urity)?|itins?|passports?)(?![a-z])/i;
  /* compact form catches separator-stripped labels ("Tax-ID#" -> "taxid");
   * restricted to tokens that can't be substrings of ordinary labels */
  const SENSITIVE_COMPACT = /(socialsecurity|socsec|ssnum|passport)/;
  function isSensitiveSource(label) {
    const spaced = String(label).toLowerCase();
    return SENSITIVE_SOURCE.test(spaced) || SENSITIVE_COMPACT.test(spaced.replace(/[^a-z]/g, ""));
  }

  /* the candidate an agent-taught mapping points at: a normalized rule path,
   * or "label:<canonical captured label>" - the label form reaches ANY held
   * field (2nd driver, vehicle 2 VIN, garaging address...), explicit user
   * intent bypassing the generic-label drop */
  /* secured targets ("secure:primarycontact.iacrm_socialsecuritynumber")
   * never resolve from the payload: they fill in a separate pass with values
   * handed only to the frame that holds the mapped control */
  function isSecurePath(path) { return typeof path === "string" && path.indexOf("secure:") === 0; }

  function overrideCandidate(overrides, key, candidates, payloadFields, values) {
    const path = overrides[key];
    if (!path || path === "skip" || isSecurePath(path)) return null;
    /* any mapping target the capture holds a value for: CRM columns, row
     * slots ("Driver 2 DOB" = contact3.dateOfBirth), policies... */
    if (values && typeof values[path] === "string" && clean(values[path])) {
      const known = candidates.find((c) => c.path === path);
      return known || { path, value: clean(values[path]) };
    }
    if (path.indexOf("label:") === 0) {
      const wanted = path.slice(6);
      /* label targets can come from an IMPORTED share file: never let one pull
       * identifiers or payment data out of the capture, whatever the file says */
      if (isSensitiveSource(wanted) || PAYMENT_FIELD.test(wanted)) return null;
      const field = (payloadFields || []).find((f) => mapper.canonical(f.label) === wanted && clean(f.value) && !isSensitiveSource(f.label));
      return field ? { path, value: clean(field.value) } : null;
    }
    return candidates.find((c) => c.path === path) || null;
  }

  /* SUPERVISED ADVANCE (opt-in): when no visible required field is left
   * blank, click the page's plain continue button. Allowlist verbs only -
   * never submit/purchase/bind/pay/rate; the agent watches the tab. */
  async function advance(fillRoot) {
    try {
      await new Promise((r) => setTimeout(r, 400));
      const requiredBlank = Array.from(fillRoot.querySelectorAll("input, select, textarea"))
        .filter((el) => visible(el) && !el.disabled && (el.required || el.getAttribute("aria-required") === "true"))
        .some((el) => blank(el));
      if (requiredBlank) return null;
      const STOP = /submit|purchase|bind|pay|checkout|finalize|order|agree|buy|rate/i;
      const target = Array.from(fillRoot.querySelectorAll("button, [role='button'], input[type='submit']"))
        .filter((b) => b.getClientRects().length && !b.disabled)
        .find((b) => {
          const t = clean(b.innerText || b.value || "");
          return /^(next|continue|start quote|save and continue|save & continue)$/i.test(t) && !STOP.test(t);
        });
      if (!target) return null;
      target.click();
      return "Advanced: " + clean(target.innerText || target.value || "button");
    } catch (_e) { return null; /* best effort */ }
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
    const values = (payload && payload.values) || {};
    /* secured mappings present in THIS frame: the worker fetches only these
     * and sends them back to this frame alone */
    const secure = [];

    for (const element of controls) {
      const name = fieldName(element);
      if (!name || PAYMENT_FIELD.test(name)) continue;
      if (element.type !== "radio" && isSecurePath(ov[controlKey(element)])) {
        if (overwrite || blank(element)) secure.push({ key: controlKey(element), path: ov[controlKey(element)] });
        continue;
      }
      /* an identifier field nobody mapped as secured is never auto-filled */
      if (!ov[controlKey(element)] && isSensitiveSource(name)) continue;
      if (element.type === "radio") {
        const fieldset = element.closest("fieldset");
        const groupKey = element.name ? `name:${element.name}` : fieldset || element;
        if (handledRadioGroups.has(groupKey)) continue;
        handledRadioGroups.add(groupKey);
        const mapKey = controlKey(element);
        if (ov[mapKey] === "skip") continue;
        const candidate = overrideCandidate(ov, mapKey, candidates, payload && payload.fields, values) || (ov[mapKey] ? null : mapper.matchField(name, candidates));
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
      /* a timeline-note mapping is capture-only: nothing to fill */
      if (/^note(:|$)/.test(ov[mapKey] || "")) continue;
      const candidate = overrideCandidate(ov, mapKey, candidates, payload && payload.fields, values) || (ov[mapKey] ? null : mapper.matchField(name, candidates));
      if (!candidate) {
        if (ov[mapKey]) results.push({ label: name, path: ov[mapKey], status: "no-data" });
        continue;
      }
      const outcome = await fillControl(element, candidate, overwrite, addrCtx, name);
      results.push({ label: name, path: candidate.path, status: outcome.status });
    }

    /* address-verification dialogs ("We found an alternate address ... Select
     * address"): confirm ONLY when the dialog's suggested address carries the
     * captured street number AND the captured ZIP or city - a value
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

    /* secured fields on this frame fill in a second pass: advancing now
     * would leave them behind, so the worker advances after that pass */
    if (autoAdvance && !secure.length) {
      const advanced = await advance(fillRoot);
      if (advanced) results.push({ label: advanced, path: "advance", status: "filled" });
    }

    const filled = results.filter((result) => result.status === "filled");
    return {
      filledCount: filled.length,
      existingCount: results.filter((result) => result.status === "existing").length,
      optionMismatchCount: results.filter((result) => result.status === "option-mismatch").length,
      controlCount: controls.length,
      filled: filled.map(({ label, path }) => ({ label, path })),
      noData: results.filter((result) => result.status === "no-data").map(({ label, path }) => ({ label, path })),
      secure
    };
  }

  /* second pass, secured values only: fills ONLY controls whose saved
   * mapping names a secured target that `values` carries. Values are never
   * echoed back; the result lists labels and target paths. */
  async function fillSecure(values, overwrite, overrides) {
    const ov = overrides || {};
    const vals = values || {};
    const filled = [];
    let missing = 0;
    for (const element of pageControls(activeModal() || document)) {
      if (element.type === "radio" || element.type === "checkbox" || element.tagName === "SELECT") continue;
      const key = controlKey(element);
      const path = ov[key];
      if (!isSecurePath(path)) continue;
      if (!overwrite && !blank(element)) continue;
      const value = typeof vals[path] === "string" ? vals[path] : "";
      if (!value) { missing += 1; continue; }
      setNativeValue(element, value);
      dispatch(element, value);
      filled.push({ label: fieldName(element), path });
    }
    return { filled, missing };
  }

  /* the choices a selection control offers, in the page's own wording (the
   * mapping editor binds each one to an exact CRM choice) */
  const PLACEHOLDER_OPTION = /^(select|choose|please|--|- -|none selected)/i;
  function choiceOptions(element) {
    let texts = [];
    if (element.tagName === "SELECT") {
      texts = Array.from(element.options).map((o) => clean(o.textContent));
    } else if ((element.type || "").toLowerCase() === "radio") {
      const fieldset = element.closest("fieldset");
      texts = Array.from(document.querySelectorAll("input[type='radio']"))
        .filter((r) => (element.name ? r.name === element.name : r.closest("fieldset") === fieldset))
        .map((r) => optionName(r));
    } else {
      return undefined;
    }
    const out = Array.from(new Set(texts.filter((t) => t && t.length <= 100 && !PLACEHOLDER_OPTION.test(t))));
    return out.length ? out.slice(0, 100) : undefined;
  }

  /* CHOICES of one mapped field, for the choice-mapping editor: its current
   * value plus every option it offers, in the page's wording. Styled
   * dropdowns (Angular Material, Kendo, ARIA comboboxes) only render their
   * options while open: the dropdown is opened, read and closed again -
   * nothing is selected. Identifier and payment fields are refused. */
  const OPTION_SELECTOR = "[role='listbox'] [role='option'], mat-option, .mat-option, .mat-mdc-option, .k-list-item, .k-list li, .k-animation-container li, .dropdown-menu.show .dropdown-item, [class*='select__option']";
  function visibleOptionTexts() {
    return Array.from(new Set(Array.from(document.querySelectorAll(OPTION_SELECTOR))
      .filter((o) => o.getClientRects().length)
      .map((o) => clean(o.innerText || o.textContent))
      .filter((t) => t && t.length <= 100 && !PLACEHOLDER_OPTION.test(t))));
  }
  function choiceHost(el) {
    return el.closest("select, [role='combobox'], mat-select, [aria-haspopup='listbox'], .k-dropdown, .k-dropdownlist, .k-picker, .mat-mdc-select, .mat-select") || el;
  }
  /* a field found by its visible label (data-service sources: the mapping
   * names the service's field, the page shows the same field by label) */
  const LABELLED_FIELDS = "input, select, textarea, [role='combobox'], mat-select, [aria-haspopup='listbox'], .k-dropdownlist, .k-picker";
  function fieldByLabels(labels) {
    const wanted = (labels || []).map((l) => {
      const p = mapper && mapper.splitSection ? mapper.splitSection(l) : { section: "", label: l };
      return { section: p.section, label: mapper.canonical(p.label) };
    }).filter((w) => w.label);
    if (!wanted.length) return null;
    return Array.from(document.querySelectorAll(LABELLED_FIELDS))
      .filter((el) => visible(el) && !(el.type && ["hidden", "submit", "button"].indexOf(el.type) >= 0))
      .find((el) => labelsHit(wanted, el)) || null;
  }
  /* does a control answer to one of these scoped labels ("applicant
   * info>gender", "*address>city", "#contact>gender")? */
  function labelsHit(wanted, el) {
    const lab = mapper.canonical(primaryLabel(el));
    const scopes = mapper && mapper.scopesOf ? mapper.scopesOf(el) : [];
    return wanted.some((w) => w.label === lab && (mapper && mapper.scopeMatches ? mapper.scopeMatches(w.section, scopes) : !w.section));
  }
  function parseLabels(labels) {
    return (labels || []).map((l) => {
      const p = mapper && mapper.splitSection ? mapper.splitSection(l) : { section: "", label: l };
      return { section: p.section, label: mapper.canonical(p.label) };
    }).filter((w) => w.label);
  }
  /* every on-screen field a data-service field covers, as its outlined box */
  function serviceElements(labels) {
    const wanted = parseLabels(labels);
    if (!wanted.length) return [];
    const out = [];
    Array.from(document.querySelectorAll(LABELLED_FIELDS))
      .filter((el) => visible(el) && !(el.type && ["hidden", "submit", "button"].indexOf(el.type) >= 0) && labelsHit(wanted, el))
      .forEach((el) => {
        const box = el.closest("mat-form-field, .mat-mdc-form-field") || el;
        if (out.indexOf(box) < 0) out.push(box);
      });
    return out;
  }

  async function readChoices(key, labels) {
    let el = null;
    if (key && key.indexOf("pick:") === 0) {
      try { el = document.querySelector(key.slice(5)); } catch (_e) { el = null; }
    } else if (key) {
      el = Array.from(document.querySelectorAll("input, select, textarea")).find((c) => controlKey(c) === key) || null;
    } else {
      el = fieldByLabels(labels);
    }
    if (!el) return null;
    const host = choiceHost(el);
    const name = fieldName(host) || fieldName(el) || "";
    if (isSensitiveSource(name) || PAYMENT_FIELD.test(name)) return { current: "", options: [], refused: true };
    if (host.tagName === "SELECT") {
      const sel = host.options[host.selectedIndex];
      return { current: sel ? clean(sel.textContent) : "", options: choiceOptions(host) || [] };
    }
    if ((el.type || "").toLowerCase() === "radio") {
      const group = Array.from(document.querySelectorAll("input[type='radio']")).filter((r) => r.name === el.name);
      const on = group.find((r) => r.checked);
      return { current: on ? optionName(on) : "", options: choiceOptions(el) || [] };
    }
    const current = clean(host.value != null && typeof host.value === "string" ? host.value : (host.innerText || host.textContent)).slice(0, 100);
    /* options already in the DOM (aria-controls / aria-owns listbox) */
    const ownedId = host.getAttribute("aria-controls") || host.getAttribute("aria-owns");
    const owned = ownedId ? document.getElementById(ownedId) : null;
    if (owned) {
      const texts = Array.from(owned.querySelectorAll("[role='option'], li")).map((o) => clean(o.textContent)).filter((t) => t && t.length <= 100);
      if (texts.length) return { current, options: Array.from(new Set(texts)) };
    }
    /* open, read, close */
    const before = new Set(visibleOptionTexts());
    const press = (t) => {
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) =>
        t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
    };
    press(host.querySelector(".mat-mdc-select-trigger, .mat-select-trigger, .k-input-button, .k-select") || host);
    let options = [];
    for (let i = 0; i < 8 && !options.length; i += 1) {
      await new Promise((r) => setTimeout(r, 150));
      options = visibleOptionTexts().filter((t) => !before.has(t));
    }
    const esc = (t) => t && t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    esc(document.activeElement);
    esc(host);
    await new Promise((r) => setTimeout(r, 150));
    if (visibleOptionTexts().some((t) => options.indexOf(t) >= 0)) {
      /* still open: a click on the page backdrop closes CDK/Kendo overlays */
      const backdrop = document.querySelector(".cdk-overlay-backdrop");
      if (backdrop) press(backdrop); else press(host);
    }
    return { current, options };
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
        label: inSection(element, primaryLabel(element) || clean(element.getAttribute("placeholder")) || clean(element.name) || clean(element.id)) || key,
        fieldLabel: primaryLabel(element) || "",
        section: mapper && mapper.sectionOf ? mapper.sectionOf(element).key : "",
        type: element.tagName === "SELECT" ? "select" : (element.type || "text").toLowerCase(),
        payment,
        autoPath,
        mapped: typeof ov[key] === "string" ? ov[key] : null,
        options: choiceOptions(element)
      });
    }
    /* saved read-only-text teachings ("pick:<selector>" -> CRM field) show as
     * rows too, so a revisit can review/retarget/clear them */
    for (const key of Object.keys(ov)) {
      if (key.indexOf("pick:") !== 0 || seen.has(key)) continue;
      seen.add(key);
      let el = null;
      try { el = document.querySelector(key.slice(5)); } catch (_e) { /* stale selector */ }
      const snippet = el ? clean(el.innerText).slice(0, 60) : "";
      /* a styled dropdown's text is named by the dropdown's own label */
      const host = el ? choiceHost(el) : null;
      const hostLabel = host && host !== el ? primaryLabel(host) : "";
      const label = !el ? "(taught text, not on this page)"
        : hostLabel ? hostLabel
        : (inferTextLabel(el) ? inferTextLabel(el) + ": " : "") + (snippet || "(empty)");
      rows.push({ key, label, type: "text", payment: false, autoPath: null, mapped: typeof ov[key] === "string" ? ov[key] : null });
    }
    /* saved labelled-field teachings ("field:vehicles|vin") list as rows,
     * named by the field's own label (and its card count) */
    for (const key of Object.keys(ov)) {
      if (key.indexOf("field:") !== 0 || seen.has(key)) continue;
      seen.add(key);
      const m = FIELD_KEY_RE.exec(key);
      if (!m) continue;
      /* a section field on a list target reads every section of its kind */
      const family = m[2].indexOf(">") > 0 && /\[\]\./.test(String(ov[key] || ""));
      const els = typeof globalThis.__bettersFieldsByLabel === "function" ? globalThis.__bettersFieldsByLabel(m[1] || "", m[2], family) : [];
      const name = els.length && typeof globalThis.__bettersFieldLabelText === "function" ? globalThis.__bettersFieldLabelText(els[0]) : "";
      const kind = m[2].slice(0, m[2].indexOf(">")).split(" ").pop();
      const label = name
        ? (family ? name + " (every " + kind + ", " + els.length + " on this page)"
          : inSection(els[0], name) + (els.length > 1 ? " (" + els.length + " on this page)" : ""))
        : m[2].replace(">", ": ") + (m[1] ? " (" + m[1] + " page)" : "");
      rows.push({ key, label, type: "text", payment: false, autoPath: null, mapped: typeof ov[key] === "string" ? ov[key] : null });
    }
    return rows;
  }

  /* "Click a field to map it": one-shot picker installed in EVERY frame.
   * The frame whose field is clicked resolves with that control's row and
   * broadcasts a cancel so every other frame's instance resolves too
   * (allFrames executeScript waits for all of them). Esc cancels (null);
   * the short timeout resolves "timeout" so the panel can re-arm - one long
   * wait would outlive the panel's message timeout and the worker's life. */
  var activePickCancel = null;

  /* identification is NOT filling: readonly/disabled controls (Kendo and
   * other widget suites render their visible input readonly) are still
   * identifiable - only control-less types are rejected */
  function pickable(node) {
    if (!node || !node.tagName) return null;
    var tag = node.tagName.toLowerCase();
    if (tag === "label" && node.control) return pickable(node.control);
    if (tag !== "input" && tag !== "select" && tag !== "textarea") return null;
    var type = (node.type || "").toLowerCase();
    if (["hidden", "password", "file", "submit", "button", "reset", "image"].indexOf(type) !== -1) return null;
    return node;
  }

  /* tr/td/th are grid STRUCTURE, never composite widgets: a grid row's own
   * controls (action menus, Primary checkboxes) must not make the row win
   * over the clicked cell's text (the row-level controls remain directly
   * clickable themselves) */
  var PICK_STOP = { form: 1, table: 1, tbody: 1, tr: 1, td: 1, th: 1, main: 1, section: 1, body: 1, html: 1 };

  /* --- read-only text picking: source pages (AMS/CRM details views) render
   * values as plain text, not controls. A clicked text leaf is teachable as
   * "always capture this element's text as <CRM field>" --- */

  function textPickable(node) {
    if (!node || node.nodeType !== 1 || !node.tagName) return null;
    var tag = node.tagName.toLowerCase();
    if (["script", "style", "svg", "path", "input", "select", "textarea", "button", "iframe", "body", "html"].indexOf(tag) !== -1) return null;
    if (node.children.length > 3) return null;
    var t = clean(node.innerText || node.textContent || "");
    if (!t || t.length > 300) return null;
    return node;
  }

  /* stable-enough re-locator: tag:nth-of-type chain up to the nearest id'd
   * ancestor (ASP.NET/NowCerts ids are stable) or the body */
  /* ids a framework generates per render (Angular Material/CDK, React useId,
   * Kendo, Radix, MUI, GUIDs) change between visits: never anchor on them */
  var GENERATED_ID = /^(mat|cdk|ng|react|ember|ext|radix|headlessui|mui|kendo|k|select2|aria|downshift|rc|el|v)[-_]|^:r[0-9a-z]*:$|^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}|^[0-9a-f]{16,}$/i;
  function cssPath(el) {
    var parts = [];
    var n = el;
    while (n && n.nodeType === 1 && n.tagName.toLowerCase() !== "html") {
      if (n.id && !GENERATED_ID.test(n.id)) {
        parts.unshift("#" + (window.CSS && CSS.escape ? CSS.escape(n.id) : n.id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")));
        return parts.join(" > ");
      }
      var tag = n.tagName.toLowerCase();
      var parent = n.parentElement;
      var idx = 1;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (s) { return s.tagName === n.tagName; });
        idx = Array.prototype.indexOf.call(sibs, n) + 1;
      }
      parts.unshift(tag + ":nth-of-type(" + idx + ")");
      n = parent;
    }
    return parts.join(" > ");
  }

  /* best-effort label for a text value: its table row/column header, a
   * preceding bold/label sibling, or aria metadata */
  function inferTextLabel(el) {
    var cell = el.closest ? el.closest("td") : null;
    if (cell) {
      var row = cell.parentElement;
      var table = cell.closest("table");
      if (row && row.children.length === 2 && row.children[1] === cell) {
        var left = clean(row.children[0].innerText || row.children[0].textContent).replace(/[:*]+$/, "");
        if (left && left.length <= 60) return left;
      }
      if (table && row) {
        var head = table.querySelector("tr");
        var idx = Array.prototype.indexOf.call(row.children, cell);
        if (head && head !== row && head.children[idx] && /^th$/i.test(head.children[idx].tagName)) {
          var h = clean(head.children[idx].innerText || head.children[idx].textContent);
          if (h && h.length <= 60) return h;
        }
      }
    }
    var prev = el.previousElementSibling;
    if (prev && /^(STRONG|B|LABEL|DT|TH|SPAN|DIV)$/.test(prev.tagName)) {
      var p = clean(prev.innerText || prev.textContent).replace(/[:*]+$/, "");
      if (p && p.length <= 60 && p !== clean(el.innerText || el.textContent)) return p;
    }
    var aria = el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title"));
    if (aria && clean(aria).length <= 60) return clean(aria);
    return "";
  }

  /* composedPath reaches inside shadow roots (web-component carrier pages),
   * so a pick can identify fields the flat query scan cannot see. Returns
   * { control, box }: box is the element to outline - for composite widgets
   * (Kendo dropdowns, styled date pickers) the user clicks a wrapper span
   * while the real control sits CSS-hidden inside it, so the smallest
   * wrapper on the click path holding a couple of controls resolves too. */
  function pickTarget(event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    var i;
    for (i = 0; i < path.length; i += 1) {
      var hit = pickable(path[i]);
      if (hit) return { control: hit, box: hit };
    }
    for (i = 0; i < path.length; i += 1) {
      var node = path[i];
      if (!node || !node.tagName || !node.querySelectorAll) continue;
      if (PICK_STOP[node.tagName.toLowerCase()]) break;
      /* visible controls only: a CSS-hidden input near the click (collapsed
       * inline-edit boxes on AMS pages) can't be scanned or filled, so it
       * must lose to the text fallback below */
      var inner = Array.prototype.filter.call(
        node.querySelectorAll("input, select, textarea"),
        function (c) { return pickable(c) && visible(c); }
      );
      if (inner.length >= 1 && inner.length <= 3) return { control: inner[0], box: node };
    }
    /* no control anywhere near - read-only text (AMS details pages):
     * teachable as a capture source */
    for (i = 0; i < path.length; i += 1) {
      var textEl = textPickable(path[i]);
      if (textEl) return { control: null, textEl: textEl, box: textEl };
    }
    return null;
  }

  function pickField(timeoutMs) {
    if (activePickCancel) activePickCancel();
    return new Promise(function (resolve) {
      var done = false;
      var hovered = null;
      var hoveredOutline = "";
      var hoveredOffset = "";
      var timer = null;

      function clearHover() {
        if (!hovered) return;
        hovered.style.outline = hoveredOutline;
        hovered.style.outlineOffset = hoveredOffset;
        hovered = null;
      }

      function finish(result) {
        if (done) return;
        done = true;
        activePickCancel = null;
        clearHover();
        document.removeEventListener("mouseover", onHover, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("message", onMessage);
        if (timer) clearTimeout(timer);
        resolve(result);
      }

      /* walk the whole frame tree from the top; length/frames/postMessage are
       * readable on cross-origin windows, so every instance gets the cancel */
      function broadcastCancel() {
        var queue = [window.top];
        while (queue.length) {
          var w = queue.shift();
          try {
            w.postMessage({ __bettersPick: "cancel" }, "*");
            for (var i = 0; i < w.frames.length; i += 1) queue.push(w.frames[i]);
          } catch (_e) { /* inaccessible frame - its own timeout ends it */ }
        }
      }

      function onHover(event) {
        var t = pickTarget(event);
        var box = t ? t.box : null;
        if (box === hovered) return;
        clearHover();
        if (!box) return;
        hovered = box;
        hoveredOutline = box.style.outline;
        hoveredOffset = box.style.outlineOffset;
        box.style.outline = "2px solid #0f6cbd";
        box.style.outlineOffset = "1px";
      }

      function onClick(event) {
        var t = pickTarget(event);
        if (!t) return;
        event.preventDefault();
        event.stopPropagation();
        if (t.control) {
          var el = t.control;
          var name = fieldName(el) || "";
          var plain = primaryLabel(el) || clean(el.getAttribute("placeholder")) || clean(el.name) || clean(el.id);
          finish({
            key: controlKey(el),
            label: inSection(el, plain) || controlKey(el),
            fieldLabel: plain,
            section: mapper && mapper.sectionOf ? mapper.sectionOf(el).key : "",
            scopes: mapper && mapper.scopesOf ? mapper.scopesOf(el) : [],
            type: el.tagName === "SELECT" ? "select" : (el.type || "text").toLowerCase(),
            payment: PAYMENT_FIELD.test(name),
            autoPath: null,
            mapped: null,
            options: choiceOptions(el)
          });
        } else {
          /* read-only text: key is a re-locatable selector, so the taught
           * binding extracts this element's text on every future capture */
          var tx = t.textEl;
          /* inside a styled dropdown, the field's own label names it
           * ("Education"), not the value it shows ("Bachelors") */
          var host = choiceHost(tx);
          var hostLabel = host !== tx ? primaryLabel(host) : "";
          var inferred = hostLabel || inferTextLabel(tx);
          var snippet = clean(tx.innerText || tx.textContent).slice(0, 60);
          /* inside a LABELLED form field (any site's design system): map the
           * field by its label - it survives re-renders and covers every
           * card that repeats it; otherwise a re-locatable selector */
          var boxLabel = typeof globalThis.__bettersFormFieldLabel === "function" ? globalThis.__bettersFormFieldLabel(tx) : "";
          var labelKey = boxLabel ? boxLabel.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80) : "";
          /* a sub-section's field ("Other Address" City) is its own mapping,
           * never its twin's in the other section */
          var sec = mapper && mapper.sectionOf ? mapper.sectionOf(tx) : { key: "", text: "" };
          finish({
            key: labelKey && !isSensitiveSource(boxLabel) ? "field:" + (sec.key ? sec.key.slice(0, 40) + ">" : "") + labelKey : "pick:" + cssPath(tx),
            label: (labelKey && inSection(tx, boxLabel)) || hostLabel || ((inferred ? inferred + ": " : "") + snippet),
            fieldLabel: boxLabel || hostLabel || inferred,
            section: sec.key,
            scopes: mapper && mapper.scopesOf ? mapper.scopesOf(tx) : [],
            type: "text",
            payment: PAYMENT_FIELD.test(inferred),
            autoPath: null,
            mapped: null
          });
        }
        broadcastCancel();
      }

      function onKey(event) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        finish(null);
        broadcastCancel();
      }

      function onMessage(event) {
        if (event.data && event.data.__bettersPick === "cancel") finish(null);
      }

      /* "timeout" (vs null for a cancel) lets the panel tell "nothing yet,
       * re-arm" apart from "user said stop"; 20s keeps each round trip
       * safely under the panel's 25s message timeout */
      timer = setTimeout(function () { finish("timeout"); }, timeoutMs || 20000);
      activePickCancel = function () { finish(null); };
      document.addEventListener("mouseover", onHover, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("message", onMessage);
    });
  }

  /* invoked per frame by the worker via chrome.scripting.executeScript func -
   * each frame (agent portals often put the form in an iframe) fills its own
   * fields and returns its own counts for the worker to aggregate */
  /* --- peek: outline every element the current mapping covers, so the agent
   * sees at a glance what is still unmapped. Green = mapped, blue dashed =
   * auto-match, grey dashed = never fill. Badges are inert overlays
   * (pointer-events: none) and every style is restored on clear. --- */
  var peekMarks = [];
  var PEEK_STYLE = {
    mapped: { outline: "3px solid #13a10e", badge: "#13a10e" },
    /* auto-matched IS mapped: green, dashed so it reads as a guess */
    auto: { outline: "2px dashed #13a10e", badge: "#13a10e" },
    skip: { outline: "2px dashed #8a8886", badge: "#8a8886" },
    unmapped: { outline: "2px solid #d13438", badge: "#d13438" }
  };

  /* badges are FIXED and re-placed on every scroll (any scroller, captured)
   * and resize: apps like EZLynx scroll an inner panel, not the window, so a
   * one-time document position drifts. A badge hides while its field is
   * scrolled out of view, including clipped inside a scrolling panel. */
  var peekRaf = 0;
  function placeBadges() {
    peekMarks.forEach(function (m) {
      if (!m.badge) return;
      var r = m.el.getBoundingClientRect();
      var inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      if (inView && typeof document.elementFromPoint === "function") {
        var hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
        inView = !hit || hit === m.el || m.el.contains(hit) || hit.contains(m.el);
      }
      m.badge.style.display = inView ? "" : "none";
      m.badge.style.left = Math.max(0, r.left) + "px";
      m.badge.style.top = Math.max(0, r.top - 15) + "px";
    });
  }
  function onPeekScroll() {
    if (peekRaf) return;
    peekRaf = requestAnimationFrame(function () { peekRaf = 0; placeBadges(); });
  }
  function watchBadges(on) {
    document.removeEventListener("scroll", onPeekScroll, true);
    window.removeEventListener("resize", onPeekScroll);
    if (on) {
      document.addEventListener("scroll", onPeekScroll, true);
      window.addEventListener("resize", onPeekScroll);
      placeBadges();
    }
  }

  /* outlines/badges left on the page by an EARLIER copy of this script (an
   * extension update orphans it mid-peek): badges carry data-betters-peek;
   * outlines are tagged since, and older ones are known by their exact
   * peek colors with the 1px offset */
  var PEEK_COLORS = /rgb\((19, 161, 14|15, 108, 189|138, 136, 134|209, 52, 56)\)|#(13a10e|0f6cbd|8a8886|d13438)/i;
  function sweepStalePeek() {
    try {
      document.querySelectorAll("[data-betters-peek]").forEach(function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
      document.querySelectorAll("[data-betters-peek-outline]").forEach(function (el) {
        el.style.outline = el.getAttribute("data-betters-peek-outline") || "";
        el.style.outlineOffset = el.getAttribute("data-betters-peek-offset") || "";
        el.removeAttribute("data-betters-peek-outline");
        el.removeAttribute("data-betters-peek-offset");
      });
      document.querySelectorAll("[style*=\"outline\"]").forEach(function (el) {
        if (el.style.outlineOffset === "1px" && PEEK_COLORS.test(el.style.outline)) { el.style.outline = ""; el.style.outlineOffset = ""; }
      });
    } catch (_e) { /* best effort */ }
  }

  function clearPeek() {
    peekMarks.forEach(function (m) {
      if (m.el) {
        m.el.style.outline = m.outline; m.el.style.outlineOffset = m.offset;
        m.el.removeAttribute("data-betters-peek-outline");
        m.el.removeAttribute("data-betters-peek-offset");
      }
      if (m.badge && m.badge.parentNode) m.badge.parentNode.removeChild(m.badge);
    });
    peekMarks = [];
    watchBadges(false);
    sweepStalePeek();
  }

  function markPeek(el, kind, label) {
    var s = PEEK_STYLE[kind] || PEEK_STYLE.mapped;
    var mark = { el: el, outline: el.style.outline, offset: el.style.outlineOffset, badge: null };
    if (!el.hasAttribute("data-betters-peek-outline")) {
      el.setAttribute("data-betters-peek-outline", el.style.outline || "");
      el.setAttribute("data-betters-peek-offset", el.style.outlineOffset || "");
    }
    el.style.outline = s.outline;
    el.style.outlineOffset = "1px";
    if (label) {
      var b = document.createElement("div");
      b.textContent = label;
      b.setAttribute("data-betters-peek", "1");
      b.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;font:600 10px/1.3 Segoe UI,Arial,sans-serif;" +
        "color:#fff;padding:1px 4px;border-radius:3px;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;" +
        "background:" + s.badge;
      document.body.appendChild(b);
      mark.badge = b;
    }
    peekMarks.push(mark);
  }

  /* items: [{key, label, kind, array}] - control keys resolve through the
   * same controlKey the fill uses; "pick:" keys through their selector, and
   * array teachings through the capture's own row expansion */
  function peek(items, keep) {
    if (!keep) clearPeek();
    if (!Array.isArray(items) || !items.length) return { shown: 0, missing: 0 };
    var byKey = {};
    Array.prototype.forEach.call(document.querySelectorAll("input, select, textarea"), function (el) {
      var type = (el.type || "").toLowerCase();
      if (["hidden", "password", "file", "submit", "button", "reset", "image"].indexOf(type) !== -1 || !visible(el)) return;
      var k = controlKey(el);
      (byKey[k] = byKey[k] || []).push(el);
    });
    var shown = 0;
    var missing = 0;
    items.forEach(function (it) {
      if (!it || typeof it.key !== "string") return;
      var els = [];
      var fk = FIELD_KEY_RE.exec(it.key);
      if (Array.isArray(it.labels)) {
        /* a data-service field: the on-screen fields its scoped labels name */
        els = serviceElements(it.labels);
      } else if (fk) {
        els = (typeof globalThis.__bettersFieldsByLabel === "function" ? globalThis.__bettersFieldsByLabel(fk[1] || "", fk[2], it.family) : [])
          .filter(function (e) { return visible(e); });
      } else if (it.key.indexOf("pick:") === 0) {
        var sel = it.key.slice(5);
        var rows = it.array && typeof globalThis.__bettersExpandTaughtRows === "function"
          ? globalThis.__bettersExpandTaughtRows(sel) : null;
        if (rows) els = rows.map(function (r) { return r.el; }).filter(function (e) { return visible(e); });
        else { var one = null; try { one = document.querySelector(sel); } catch (_e) { /* stale */ } if (one && visible(one)) els = [one]; }
      } else {
        els = byKey[it.key] || [];
      }
      if (!els.length) { missing += 1; return; }
      shown += 1;
      els.forEach(function (el, i) {
        markPeek(el, it.kind, i === 0 ? String(it.label || "") + (it.array && els.length > 1 ? " (" + els.length + " rows)" : "") : "");
      });
    });
    watchBadges(true);
    return { shown: shown, missing: missing };
  }

  /* ONE view of the page: mapped fields in green (with what they feed),
   * everything the capture reads that nothing covers in red. Covered for
   * red = the items shown plus the saved map, auto-matches and (data-service
   * sites) fields the service fills. */
  /* the outlines stay live while the editor is open: when the page redraws
   * (an SPA step change, an added vehicle card) they re-apply on their own.
   * Only real content changes count - the badges this script adds are
   * ignored, so re-applying never feeds itself. */
  var lastPeekArg = null;
  var peekObserver = null;
  var peekRedo = 0;
  function isOwnNode(n) { return n && n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-betters-peek"); }
  function watchPage(on) {
    if (peekObserver) { peekObserver.disconnect(); peekObserver = null; }
    if (!on || typeof MutationObserver !== "function" || !document.body) return;
    peekObserver = new MutationObserver(function (records) {
      var real = records.some(function (r) {
        var nodes = Array.prototype.slice.call(r.addedNodes).concat(Array.prototype.slice.call(r.removedNodes));
        return nodes.some(function (n) { return n.nodeType === 1 && !isOwnNode(n); });
      });
      if (!real || !lastPeekArg) return;
      clearTimeout(peekRedo);
      peekRedo = setTimeout(function () { if (lastPeekArg) peekAll(lastPeekArg, true); }, 700);
    });
    peekObserver.observe(document.body, { childList: true, subtree: true });
  }

  function peekAll(arg, redo) {
    lastPeekArg = arg;
    if (!redo) watchPage(true);
    clearPeek();
    var items = (arg && Array.isArray(arg.items)) ? arg.items : [];
    var r = peek(items, true);
    var map = {};
    Object.keys((arg && arg.map) || {}).forEach(function (k) { map[k] = arg.map[k]; });
    items.forEach(function (it) { if (it && typeof it.key === "string") map[it.key] = map[it.key] || (it.family ? "family" : "shown"); });
    var u = peekUnmapped({ map: map, payload: arg && arg.payload, pageLabels: arg && arg.pageLabels }, true);
    watchBadges(true);
    return { shown: r.shown, missing: r.missing, unmapped: u.shown };
  }

  /* "peek unmapped": outline in RED every element the capture reads that
   * nothing covers. Covered = a control with a saved mapping (incl. "Never
   * fill" - a deliberate decision) or an auto-match against the held
   * capture; a taught text location (every row for array/note teachings) or
   * anything inside/around one; or, on data-service sites (EZLynx), a screen
   * field whose label a MAPPED data-service field covers. */
  function peekUnmapped(arg, keep) {
    if (!keep) clearPeek();
    const all = typeof globalThis.__bettersCaptureElements === "function" ? globalThis.__bettersCaptureElements() : [];
    if (!all.length) return { shown: 0, missing: 0 };
    const covered = [];
    const keys = arg && arg.map && typeof arg.map === "object" ? arg.map : {};
    const coveredKeys = new Set(Object.keys(keys).filter(function (k) { return keys[k]; }));
    try {
      scanControls(arg && arg.payload ? arg.payload : null, keys).forEach(function (r) { if (r.autoPath) coveredKeys.add(r.key); });
    } catch (_e) { /* auto-matching is best-effort here */ }
    const canon = function (v) { return mapper && mapper.canonical ? mapper.canonical(v) : String(v || "").toLowerCase().trim(); };
    /* a service label may name its section ("primary address>city"): the
     * twin field in another section stays uncovered */
    const serviceLabels = ((arg && arg.pageLabels) || []).map(function (l) {
      const p = mapper && mapper.splitSection ? mapper.splitSection(l) : { section: "", label: l };
      return { section: p.section, label: canon(p.label) };
    });
    const serviceCovers = function (el) {
      const lab = canon(primaryLabel(el) || fieldName(el));
      const scopes = mapper && mapper.scopesOf ? mapper.scopesOf(el) : [];
      return serviceLabels.some(function (s) { return s.label === lab && (mapper && mapper.scopeMatches ? mapper.scopeMatches(s.section, scopes) : !s.section); });
    };
    Object.keys(keys).forEach(function (k) {
      const fk = FIELD_KEY_RE.exec(k);
      if (keys[k] && fk && typeof globalThis.__bettersFieldsByLabel === "function") {
        const family = keys[k] === "family" || /\[\]\./.test(String(keys[k]));
        globalThis.__bettersFieldsByLabel(fk[1] || "", fk[2], family).forEach(function (el) { covered.push(el); });
        return;
      }
      if (!keys[k] || k.indexOf("pick:") !== 0) return;
      const sel = k.slice(5);
      const multi = /\[\]\.|^note/.test(String(keys[k]));
      const rows = multi && typeof globalThis.__bettersExpandTaughtRows === "function" ? globalThis.__bettersExpandTaughtRows(sel) : null;
      if (rows) rows.forEach(function (r) { covered.push(r.el); });
      else { let one = null; try { one = document.querySelector(sel); } catch (_e) { /* stale */ } if (one) covered.push(one); }
    });
    let shown = 0;
    all.forEach(function (el) {
      const tag = el.tagName;
      const isControl = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.getAttribute("role");
      if (isControl && coveredKeys.has(controlKey(el))) return;
      if (isControl && serviceLabels.length && serviceCovers(el)) return;
      if (covered.some(function (c) { return c === el || c.contains(el) || el.contains(c); })) return;
      markPeek(el, "unmapped", "");
      shown += 1;
    });
    return { shown: shown, missing: 0 };
  }

  globalThis.__bettersPortalPeekUnmapped = (arg) => (arg ? peekUnmapped(arg) : (clearPeek(), { shown: 0, missing: 0 }));
  globalThis.__bettersPortalPeek = (items) => (items ? peek(items) : (clearPeek(), { shown: 0, missing: 0 }));
  globalThis.__bettersPortalPeekAll = (arg) => (arg ? peekAll(arg)
    : (lastPeekArg = null, watchPage(false), clearPeek(), { shown: 0, missing: 0, unmapped: 0 }));
  globalThis.__bettersPortalFill = (payload, overwrite, autoAdvance, overrides) => fill(payload, Boolean(overwrite), Boolean(autoAdvance), overrides || {});
  globalThis.__bettersPortalFillSecure = (values, overwrite, overrides) => fillSecure(values, Boolean(overwrite), overrides || {});
  globalThis.__bettersPortalAdvance = () => advance(activeModal() || document);
  globalThis.__bettersPortalChoices = (key, labels) =>
    (typeof key === "string" && key) || Array.isArray(labels) ? readChoices(typeof key === "string" ? key : "", labels) : null;
  /* shared with the ingester, so a control's saved mapping routes its value
   * on capture exactly as it does on fill */
  globalThis.__bettersControlKey = controlKey;
  globalThis.__bettersIsSensitiveLabel = isSensitiveSource;
  globalThis.__bettersPortalScan = (payload, overrides) => scanControls(payload, overrides || {});
  globalThis.__bettersPortalPick = (timeoutMs) => pickField(timeoutMs);
  globalThis.__bettersPortalPickCancel = () => { if (activePickCancel) activePickCancel(); };
})();
