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

  /* A page can give several inputs ONE id (a shared amount component): every
   * label[for] then points at that id, and the first label would name all of
   * them. When more than one label claims the id, the label inside this
   * control's own box names it; otherwise the first label, as before. */
  const OWN_BOX = "mat-form-field, .mat-form-field, .mat-mdc-form-field, .k-floating-label-container, .form-group, .form-field, .field";
  function explicitLabel(element) {
    if (!element.id) return "";
    const selector = `label[for="${CSS.escape(element.id)}"]`;
    /* the label inside this control's own box first (one lookup scoped to the
     * box, never a scan of every label that shares the id), else the first
     * label on the page, as before */
    const box = element.closest(OWN_BOX);
    const label = (box && box.querySelector(selector)) || document.querySelector(selector);
    return clean(label && (label.innerText || label.textContent));
  }

  /* SPA portals (e.g. GEICO's quote workspace) put the visible label in an
   * ancestor container instead of label[for]/aria - mirror the harvester's
   * fallback so those fields are matchable too. */
  function containerLabel(control) {
    const question = control.closest("icq-question");
    const caption = question && question.querySelector(":scope > label");
    if (caption) return clean(caption.innerText || caption.textContent).slice(0, 140);
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
    /* EZLynx carrier selects point aria-labelledby at the selected answer.
     * The question's own caption is the stable field identity. */
    const question = element.tagName === "MAT-SELECT" ? element.closest("icq-question") : null;
    const caption = question && question.querySelector(":scope > label");
    if (caption) return clean(caption.innerText || caption.textContent).slice(0, 140);
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
  /* THE KEY EVERY SAVED MAPPING WAS TAKEN AGAINST. Never change what this
   * returns for a control: saved mappings (agents hold dozens) are stored
   * under it and must keep resolving exactly as they always have. */
  function rawLegacyKey(element) {
    if ((element.type || "").toLowerCase() === "radio") {
      return "radio:" + (clean(element.name) || mapper.canonical(primaryLabel(element)).slice(0, 60)) + sectionSuffix(element);
    }
    const tag = element.tagName === "SELECT" ? "select" : (element.type || "text").toLowerCase();
    const base = clean(element.name) || clean(element.id) || mapper.canonical(primaryLabel(element) || fieldName(element)).slice(0, 60);
    return (tag + ":" + base).slice(0, 120) + sectionSuffix(element);
  }

  /* Everything below is computed ONCE per tick (a scan, a capture or a peek
   * runs inside one): each control's legacy key, own label and final key, and
   * each shared-key group's label set. A fill pass awaits between controls, so
   * it pins the cache for its whole run instead. */
  let tickCache = null;
  let pinned = 0;
  function tick() {
    if (tickCache) return tickCache;
    const c = { legacy: new Map(), own: new Map(), keys: new Map(), ownKeys: new Map(), groups: null, bases: null, docGroups: null, repeat: null };
    tickCache = c;
    Promise.resolve().then(() => { if (!pinned && tickCache === c) tickCache = null; });
    return c;
  }
  function legacyControlKey(element) {
    const c = tick();
    let k = c.legacy.get(element);
    if (k === undefined) { k = rawLegacyKey(element); c.legacy.set(element, k); }
    return k;
  }

  /* Controls that share a name or id yet carry DIFFERENT labels are different
   * fields (the BI, Collision, MP and PD amount boxes of one accident card
   * share one amount component), so under the legacy key they merge into one
   * field "repeated" on every card. Such a control gets its own key: the
   * legacy key plus "~<its label>". Controls with the same label (the same
   * field on each card) and controls whose key came from a label keep the
   * legacy key. */
  /* the capture's own visibility test (portal-ingest isVisible): the box's own
   * display and visibility, and no [hidden] / [aria-hidden] ancestor. It needs
   * no layout, so a box inside a display:none container (a hidden tab pane)
   * passes it although fill's visible() (a non-zero rect) rejects it. Grouping
   * counts a box when EITHER test accepts it, so every box the capture reads is
   * also grouped. */
  function captureVisible(element) {
    if (!element || element.closest("[hidden], [aria-hidden='true']")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }
  /* name/id part of a control's legacy key, without its section: a cheap
   * attribute read, so grouping candidates never runs the section lookup */
  function keyBase(el) {
    const tag = el.tagName === "SELECT" ? "select" : (el.type || "text").toLowerCase();
    return (tag + ":" + (clean(el.name) || clean(el.id))).slice(0, 120);
  }
  function sharedBases() {
    const c = tick();
    if (c.bases) return c.bases;
    const byBase = new Map();
    /* every control the capture can READ: visible, of a type that carries a
     * value, in the active dialog (or the page) - read-only and disabled boxes
     * included, because the capture reads them even though a fill skips them.
     * Grouping over fewer controls than the capture reads would let a box whose
     * siblings are read-only keep the shared key and fail open. Never a radio
     * or an image button. */
    /* the capture picks its dialog with its own rule (isVisible: a dialog under
     * a [hidden] / aria-hidden ancestor is not one) and falls back to main. When
     * its root is not the root this filler picked, the two disagree about where
     * the page's boxes are, so group over the whole document, a superset. */
    const fillRoot = activeModal() || document;
    const captureRoot = typeof globalThis.__bettersCaptureRoot === "function" ? globalThis.__bettersCaptureRoot() : fillRoot;
    const root = captureRoot === fillRoot ? fillRoot : document;
    Array.from(root.querySelectorAll("input, select, textarea")).filter((el) => visible(el) || captureVisible(el)).forEach((el) => {
      const type = (el.type || "").toLowerCase();
      if (["radio", "image", "hidden", "password", "file", "submit", "button", "reset"].indexOf(type) >= 0) return;
      if (!clean(el.name) && !clean(el.id)) return;
      const k = keyBase(el);
      if (!byBase.has(k)) byBase.set(k, []);
      byBase.get(k).push(el);
    });
    c.bases = byBase;
    return byBase;
  }
  /* the controls that share this control's legacy key (same base AND same
   * section), found without computing the section of any other base */
  function sharedGroup(element, legacy) {
    const c = tick();
    if (!c.groups) c.groups = new Map();
    if (c.groups.has(legacy)) return c.groups.get(legacy);
    const candidates = sharedBases().get(keyBase(element)) || [];
    const group = candidates.length < 2 ? null
      : { els: candidates.filter((el) => legacyControlKey(el) === legacy), labels: null };
    c.groups.set(legacy, group);
    return group;
  }
  /* the control's own label: the box's label first (it stays right when an
   * id is duplicated), then the label the key logic already trusts */
  function ownLabelText(element) {
    const box = element.closest ? element.closest(OWN_BOX) : null;
    const viaIngest = box && typeof globalThis.__bettersFormFieldLabel === "function" ? globalThis.__bettersFormFieldLabel(box) : "";
    const lab = box ? box.querySelector("label, mat-label, .k-label") : null;
    return clean(viaIngest || (lab ? lab.textContent : "")).replace(/^[*\s]+|[:*\s]+$/g, "");
  }
  function ownLabelOf(element) {
    const c = tick();
    let v = c.own.get(element);
    if (v === undefined) { v = mapper.canonical(ownLabelText(element) || primaryLabel(element) || ""); c.own.set(element, v); }
    return v;
  }
  function controlKey(element) {
    const c = tick();
    let k = c.keys.get(element);
    if (k === undefined) { k = computeControlKey(element); c.keys.set(element, k); }
    return k;
  }
  /* the label as written (canonical) up to 40 characters, else its first 30
   * plus "#" and an 8-hex hash of the whole label */
  function labelHash(label) {
    let h = 0x811c9dc5;
    for (let i = 0; i < label.length; i += 1) { h ^= label.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("00000000" + h.toString(16)).slice(-8);
  }
  function labelPart(label) {
    return label.length <= 40 ? label : label.slice(0, 30) + "#" + labelHash(label);
  }
  function computeControlKey(element) {
    const legacy = legacyControlKey(element);
    if ((element.type || "").toLowerCase() === "radio" || (!clean(element.name) && !clean(element.id))) return legacy;
    if (!mapper) return legacy;
    const group = sharedGroup(element, legacy);
    if (!group || group.els.length < 2 || group.els.indexOf(element) < 0) return legacy;
    if (!ownLabelOf(element)) return legacy;
    if (!group.labels) group.labels = new Set(group.els.map(ownLabelOf).filter(Boolean));
    if (group.labels.size < 2) return legacy;
    return labelKeyOf(element) || legacy;
  }
  /* The key this box takes when it is told apart from same-name boxes: its
   * legacy key plus "~<its own label>". It depends on the box alone, never on
   * what else is on the page, so a mapping saved under it still finds the box
   * when the box is shown by itself. Null for a box that has no name or id (its
   * legacy key is already its label), a radio, or no label. */
  function labelKeyOf(element) {
    const c = tick();
    let k = c.ownKeys.get(element);
    if (k === undefined) { k = computeLabelKey(element); c.ownKeys.set(element, k); }
    return k;
  }
  function computeLabelKey(element) {
    if (!mapper) return null;
    if ((element.type || "").toLowerCase() === "radio" || (!clean(element.name) && !clean(element.id))) return null;
    const own = ownLabelOf(element);
    if (!own) return null;
    const legacy = legacyControlKey(element);
    const suffix = sectionSuffix(element);
    const head = suffix ? legacy.slice(0, legacy.length - suffix.length) : legacy;
    let part = labelPart(own);
    /* the whole key must stay within the 200 characters share-file import
     * accepts: the label part gives way, never the section suffix */
    const room = 200 - head.length - 1 - suffix.length;
    if (part.length > room) {
      if (room < 1) return null;
      const h = labelHash(own);
      part = room > h.length ? own.slice(0, room - h.length - 1) + "#" + h : h.slice(0, room);
    }
    return head + "~" + part + suffix;
  }
  /* the label the mapping editor shows: primaryLabel, except that a control
   * told apart from same-id twins is named by its own box, never by a label
   * the twins share */
  function shownLabel(element) {
    const own = controlKey(element) !== legacyControlKey(element) ? ownLabelText(element) : "";
    const label = own || primaryLabel(element);
    const system = /^yearUpdated(Heating|Electrical|Plumbing|Roofing)$/i.exec(element.name || element.id || "");
    if (system && normText(label) === "year updated") return `${system[1]}: Year Updated`;
    const scheduled = /^(coins|fineArts|furs|guns|jewelry|music|silverware)Breakage$/.exec(element.name || element.id || "");
    return scheduled && normText(label) === "breakage" ? scheduled[1].replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()) + ": Breakage" : label;
  }
  /* where this control's saved mapping lives: the key made from its own
   * label first (whatever else is on the page), else its current key. When
   * the box is the only one of its name on the page its current key IS the
   * legacy key, so a mapping saved under it keeps working exactly as before. */
  function savedKeyOf(map, element) {
    const key = controlKey(element);
    if (!map) return key;
    const own = labelKeyOf(element);
    return own && map[own] ? own : key;
  }
  /* FAIL CLOSED. A mapping saved under the shared legacy key cannot say which
   * of several differently-labelled same-name boxes it was taught on (it may
   * have been taught on BI alone). On a page where that key covers such boxes,
   * a box with no mapping of its own gets NOTHING from it: no fill, no
   * capture, no peek, no choice read. The scan flags the row for re-teach and
   * keeps the saved key untouched so a Save loses nothing. */
  function legacyRefused(map, element) {
    if (!map) return false;
    const key = controlKey(element);
    const legacy = legacyControlKey(element);
    if (key === legacy || !map[legacy]) return false;
    const own = labelKeyOf(element);
    return !(own && map[own]) && !map[key];
  }
  /* Every named control in the document (hidden, disabled and collapsed ones
   * too), grouped by legacy key: used only to decide whether a box's name is
   * shared with other boxes with different labels, wherever they are. */
  function documentGroups() {
    const c = tick();
    if (c.docGroups) return c.docGroups;
    const byKey = new Map();
    Array.from(document.querySelectorAll("input, select, textarea")).forEach((el) => {
      const type = (el.type || "").toLowerCase();
      if (["radio", "image", "hidden", "password", "file", "submit", "button", "reset"].indexOf(type) >= 0) return;
      if (!clean(el.name) && !clean(el.id)) return;
      const k = legacyControlKey(el);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(el);
    });
    c.docGroups = byKey;
    return byKey;
  }
  function nameIsShared(element) {
    const group = documentGroups().get(legacyControlKey(element));
    return Boolean(group && group.length > 1 && new Set(group.map(ownLabelOf).filter(Boolean)).size > 1);
  }
  /* The key a row (the scan's, the picker's) is listed and saved under.
   * - A mapping on the box's own-label key: that key.
   * - A mapping saved before the keys were told apart, under the box's current
   *   key: that key, untouched (it keeps resolving exactly as it did).
   * - Nothing mapped yet, and the box's name is shared with boxes that have
   *   other labels anywhere in the page (shown or not), or the site's map
   *   already holds an own-label key on that name: the box's OWN-LABEL key, so
   *   a mapping taught with only some of the boxes on screen never reaches the
   *   others.
   * - Otherwise its current key, as before. */
  function rowKeyOf(map, element) {
    const key = controlKey(element);
    const own = labelKeyOf(element);
    if (!own) return key;
    if (map && map[own]) return own;
    const legacy = legacyControlKey(element);
    if (map && (map[key] || map[legacy])) return key;
    if (nameIsShared(element)) return own;
    const stem = own.slice(0, own.indexOf("~") + 1);
    if (map && Object.keys(map).some((k) => k.indexOf(stem) === 0)) return own;
    return key;
  }
  /* "Other Address: City" for a sub-section's field, else the label */
  function inSection(element, label) {
    const s = mapper && mapper.sectionOf ? mapper.sectionOf(element) : null;
    return s && s.text && label ? s.text + ": " + label : label;
  }
  const FIELD_KEY_RE = /^field:(?:([a-z0-9 ]{1,40})\|)?((?:[a-z0-9 ]{1,40}>)?[a-z0-9 ]{1,140})$/;

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

  function pageControls(fillRoot, includeReadOnly) {
    return Array.from(fillRoot.querySelectorAll("input, select, textarea"))
      .filter(visible)
      .filter((element) => includeReadOnly || (!element.disabled && !element.readOnly))
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
      /* the label alone, or its section with it ("auto policy info prior carrier") */
      const field = (payloadFields || []).find((f) => (mapper.canonical(f.label) === wanted || mapper.canonical((f.section || "") + " " + f.label) === wanted) &&
        clean(f.value) && !isSensitiveSource(f.label));
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
    /* keys are computed once for the whole pass (it awaits between controls) */
    tickCache = null;
    pinned += 1;
    /* a fill can relabel other questions (an Angular re-render after a change
     * event), so after each control the cached keys are dropped IF anything
     * that can change a key moved: label text, label/id/name attributes. Value,
     * style and data attributes (which every fill sets) do not count, so an
     * ordinary pass stays linear. */
    let moved = false;
    const watcher = typeof MutationObserver === "function" ? new MutationObserver(() => { moved = true; }) : null;
    if (watcher) {
      watcher.observe(document, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ["aria-label", "aria-labelledby", "for", "id", "name", "type", "placeholder", "data-label"] });
    }
    keysMoved = () => {
      if (!watcher) return true;
      /* the callback runs as a microtask (a change that already happened has set
       * the flag); records still queued are read directly */
      const any = moved || watcher.takeRecords().length > 0;
      moved = false;
      return any;
    };
    try { return await fillPass(payload, overwrite, autoAdvance, overrides); }
    finally { if (watcher) watcher.disconnect(); keysMoved = () => false; pinned -= 1; tickCache = null; }
  }
  let keysMoved = () => false;
  /* after a fill: the radio key index and, when the page moved, the key cache */
  function afterFillControl(dropRadioKeys) {
    if (keysMoved()) tickCache = null;
    return dropRadioKeys;
  }
  async function fillPass(payload, overwrite, autoAdvance, overrides) {
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
    const formIds = new Map();
    let radioKeys = null;
    const values = (payload && payload.values) || {};
    /* secured mappings present in THIS frame: the worker fetches only these
     * and sends them back to this frame alone */
    const secure = [];

    for (const element of controls) {
      const name = fieldName(element);
      if (!name || PAYMENT_FIELD.test(name)) continue;
      if (legacyRefused(ov, element)) continue; /* the shared key fills nothing here */
      const savedKey = savedKeyOf(ov, element);
      if (element.type !== "radio" && isSecurePath(ov[savedKey])) {
        if (overwrite || blank(element)) secure.push({ key: savedKey, path: ov[savedKey] });
        continue;
      }
      /* an identifier field nobody mapped as secured is never auto-filled */
      if (!ov[savedKey] && isSensitiveSource(name)) continue;
      if (element.type === "radio") {
        const fieldset = element.closest("fieldset");
        /* a radio group is per form: the same name in two forms is two groups */
        const formId = element.form ? (formIds.get(element.form) || formIds.set(element.form, formIds.size + 1).get(element.form)) : 0;
        const groupKey = element.name ? `name:${formId}:${element.name}` : fieldset || element;
        if (handledRadioGroups.has(groupKey)) continue;
        handledRadioGroups.add(groupKey);
        const mapKey = savedKey;
        if (ov[mapKey] === "skip") continue;
        const candidate = overrideCandidate(ov, mapKey, candidates, payload && payload.fields, values) || (ov[mapKey] ? null : mapper.matchField(name, candidates));
        if (!candidate) continue;
        /* a nameless radio is keyed by its label or option text ("radio:no"):
         * when a radio of ANOTHER group has the same key the mapping cannot say
         * which question it means, so neither is filled. The key index is built
         * once, and only when a nameless radio actually has something to fill */
        if (!element.name) {
          if (!radioKeys) {
            radioKeys = new Map();
            controls.forEach((c) => {
              if (c.type !== "radio") return;
              const k = controlKey(c);
              if (!radioKeys.has(k)) radioKeys.set(k, []);
              radioKeys.get(k).push(c);
            });
          }
          if ((radioKeys.get(mapKey) || []).some((c) => !sameRadioGroup(c, element))) continue;
        }
        const group = controls.filter((control) => control.type === "radio" && sameRadioGroup(control, element));
        const target = group.find((control) => mapper.canonical(optionName(control)) === mapper.canonical(candidate.value));
        if (!target) { results.push({ label: name, status: "option-mismatch" }); continue; }
        const outcome = await fillControl(target, candidate, overwrite, addrCtx, name);
        radioKeys = afterFillControl(null); /* a fill can relabel other questions: the key indexes are stale */
        results.push({ label: name, path: candidate.path, status: outcome.status });
        continue;
      }
      const mapKey = savedKey;
      if (ov[mapKey] === "skip") continue;
      /* a timeline-note mapping is capture-only: nothing to fill */
      if (/^note(:|$)/.test(ov[mapKey] || "")) continue;
      const candidate = overrideCandidate(ov, mapKey, candidates, payload && payload.fields, values) || (ov[mapKey] ? null : mapper.matchField(name, candidates));
      if (!candidate) {
        if (ov[mapKey]) results.push({ label: name, path: ov[mapKey], status: "no-data" });
        continue;
      }
      const outcome = await fillControl(element, candidate, overwrite, addrCtx, name);
      radioKeys = afterFillControl(null);
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
      const path = ov[savedKeyOf(ov, element)];
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
  /* is r in the same radio group as el? Named: same name, same form. A
   * nameless radio groups only with itself or with nameless radios it provably
   * shares a group with (same fieldset, same form) - never "every radio
   * outside a fieldset", which spans other questions */
  function sameRadioGroup(r, el) {
    if ((r.type || "").toLowerCase() !== "radio") return false;
    if (r === el) return true;
    if (el.name) return r.name === el.name && r.form === el.form;
    const fieldset = el.closest("fieldset");
    return !r.name && !!fieldset && r.closest("fieldset") === fieldset && r.form === el.form;
  }
  function choiceOptions(element) {
    let texts = [];
    if (element.tagName === "SELECT") {
      texts = Array.from(element.options).map((o) => clean(o.textContent));
    } else if ((element.type || "").toLowerCase() === "radio") {
      texts = Array.from(document.querySelectorAll("input[type='radio']"))
        .filter((r) => sameRadioGroup(r, element))
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

  /* A saved key can stop matching its control: Angular and Kendo hand out
   * generated ids ("mat-select-12", "mat-input-3", ":r4:") that change every
   * time the page renders, and a styled dropdown may be a host element
   * rather than an input. Reading choices is read-only, so after an exact
   * match fails the control is found again by the key's stable part, then
   * by the label (and sub-section) the mapping editor saw it under. */
  function splitKey(key) {
    const at = key.indexOf("@");
    const head = at < 0 ? key : key.slice(0, at);
    const colon = head.indexOf(":");
    return { tag: colon < 0 ? "" : head.slice(0, colon), base: colon < 0 ? head : head.slice(colon + 1), section: at < 0 ? "" : key.slice(at + 1) };
  }
  function stableBase(base) { return String(base).replace(/\d+/g, "#"); }
  const NOT_CHOICE_TYPES = ["hidden", "password", "file", "submit", "button", "reset", "image"];
  function isNotChoice(c) { return NOT_CHOICE_TYPES.indexOf((c.type || "").toLowerCase()) >= 0; }
  /* The full per-control label lookup (explicitLabel does a document-wide
   * query per control) is quadratic, so it runs only on a short list. A label
   * index cannot stand in for it: a twin labelled only by container text would
   * be missed and the first match returned. Above the limit the answer is
   * null, never a guess. */
  const FULL_SCAN_LIMIT = 300;

  function findChoiceControl(key, hint) {
    /* never a password, hidden, file or button control, on any path */
    const all = Array.from(document.querySelectorAll(LABELLED_FIELDS))
      .filter((c) => !isNotChoice(c));
    /* keys are computed lazily and kept: an exact hit must not pay for every
     * other control (controlKey can run a document-wide label lookup) */
    const keyOf = new Map();
    const keyFor = (c) => {
      if (!keyOf.has(c)) keyOf.set(c, controlKey(c));
      return keyOf.get(c);
    };
    /* false only when the control's own name/id already shows its key cannot
     * be `key`; a control keyed by its label (no name/id) is always checked */
    const mayHaveKey = (c) => {
      const radio = (c.type || "").toLowerCase() === "radio";
      const own = clean(c.name) || (radio ? "" : clean(c.id));
      if (!own) return true;
      const tag = radio ? "radio" : (c.tagName === "SELECT" ? "select" : (c.type || "text").toLowerCase());
      return key.indexOf((tag + ":" + own).slice(0, 120)) === 0;
    };
    const exact = all.filter((c) => mayHaveKey(c) && keyFor(c) === key);
    /* the same key on two controls (numbered twin cards): refuse, never
     * hand card 2 the value of card 1 */
    /* a radio group shares one key across its buttons: same name in the same
     * form is ONE control here, read as main did (via its first button) */
    const groups = [];
    exact.forEach((c) => {
      const radio = (c.type || "").toLowerCase() === "radio";
      if (radio && c.name && groups.some((g) => (g.type || "").toLowerCase() === "radio" && g.name === c.name && g.form === c.form)) return;
      groups.push(c);
    });
    if (groups.length > 1) return null;
    if (groups.length === 1) return groups[0];
    all.forEach(keyFor); /* the exact key missed: the fallbacks need every key, once */
    /* a key made from a box's own label still finds the box when it is alone
     * on the page (its current key is then the legacy key) */
    if (key.indexOf("~") >= 0) {
      const ownHits = all.filter((c) => labelKeyOf(c) === key);
      if (ownHits.length === 1) return ownHits[0];
    }
    /* Past the exact key, a control is returned only when EXACTLY ONE
     * candidate remains: reading a look-alike field (card 1 for card 2, a
     * Driver "Type" for a Vehicle "Type") would bind the wrong choices. A
     * known section must match; an ambiguous result is null, not a guess. */
    const parts = splitKey(key);
    /* the key's tag (select, text, ...) must agree on every fallback path */
    const sameTag = all.filter((c) => splitKey(keyOf.get(c)).tag === parts.tag);
    const label = hint && hint.label ? mapper.canonical(hint.label) : "";
    /* the section comes from the KEY only; a hint that names another section
     * (or none, when the key has one) is a mismatch, not an override */
    const section = parts.section;
    if (hint && typeof hint.section === "string" && hint.section !== section) return null;
    const sectionOfEl = (c) => (mapper.sectionOf ? mapper.sectionOf(c).key : "");
    const labelOf = (c) => mapper.canonical(primaryLabel(c) || primaryLabel(choiceHost(c)));
    /* visibility never decides: a collapsed card 2 must not hand back card 1 */
    const only = (list) => (list.length === 1 ? list[0] : null);
    /* the section must agree, an empty one included: an unsectioned key
     * (a numbered card) never matches a field inside a named section */
    const inSection = (list) => list.filter((c) => sectionOfEl(c) === section);
    /* the candidates whose label is `label`, by the full lookup, on a short list only */
    const withLabel = (list) => (list.length > FULL_SCAN_LIMIT ? [] : list.filter((c) => labelOf(c) === label));
    /* a generated-id shape or a section alone names no field ("mat-select-12"
     * could be any dropdown left in the section): both fallbacks need the label */
    if (!label) return null;
    if (GENERATED_ID.test(parts.base)) {
      const want = stableBase(parts.base);
      let same = sameTag.filter((c) => {
        const k = splitKey(keyOf.get(c));
        return GENERATED_ID.test(k.base) && stableBase(k.base) === want;
      });
      same = inSection(same);
      same = withLabel(same);
      const hit = only(same);
      if (hit) return hit;
    }
    return only(withLabel(inSection(sameTag)));
  }

  async function readChoices(key, labels, hint) {
    let el = null;
    if (key && key.indexOf("pick:") === 0) {
      try { el = document.querySelector(key.slice(5)); } catch (_e) { el = null; }
    } else if (key && key.indexOf("field:") === 0) {
      // Selector teachings use labelled-field keys, including every-row
      // families. Resolve them through the same lookup used by capture/peek.
      const m = FIELD_KEY_RE.exec(key);
      const fields = m && typeof globalThis.__bettersFieldsByLabel === "function"
        ? globalThis.__bettersFieldsByLabel(m[1] || "", m[2], m[2].indexOf(">") > 0) : [];
      const box = fields[0];
      el = box ? (box.matches(LABELLED_FIELDS) ? box : box.querySelector(LABELLED_FIELDS)) : null;
    } else if (key) {
      el = findChoiceControl(key, hint);
    } else {
      el = fieldByLabels(labels);
    }
    if (!el) return null;
    const host = choiceHost(el);
    /* never a password, hidden, file or button control, on any path */
    if (isNotChoice(el) || isNotChoice(host)) return null;
    const name = fieldName(host) || fieldName(el) || "";
    if (isSensitiveSource(name) || PAYMENT_FIELD.test(name)) return { current: "", options: [], refused: true };
    if (host.tagName === "SELECT") {
      const sel = host.options[host.selectedIndex];
      return { current: sel ? clean(sel.textContent) : "", options: choiceOptions(host) || [] };
    }
    if ((el.type || "").toLowerCase() === "radio") {
      const group = Array.from(document.querySelectorAll("input[type='radio']")).filter((r) => sameRadioGroup(r, el));
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

  /* how many labelled fields on the page share a label (2+ = repeated
   * cards, one per driver), the sub-section of each, and the page step
   * ("Tracy Dittrich - Drivers" -> "drivers"): a list mapping on one card's
   * control then covers every card, like a dropdown's label mapping */
  const REPEAT_BOX = "mat-form-field, .mat-mdc-form-field, .mat-form-field, .k-floating-label-container";
  const normText = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  /* the ingester's box label also finds a question written above the box */
  function repeatBoxText(b) {
    const viaIngest = typeof globalThis.__bettersFormFieldLabel === "function" ? globalThis.__bettersFormFieldLabel(b) : "";
    const lab = b.querySelector("label, mat-label, .k-label");
    return normText(viaIngest || (lab ? lab.textContent : ""));
  }
  /* what every row of one scan needs, read once per tick instead of once per
   * row: the page's controls grouped by key, and its top-level boxes with
   * their label text */
  function repeatContext() {
    const c = tick();
    if (c.repeat) return c.repeat;
    const byKey = new Map();
    Array.from((activeModal() || document).querySelectorAll("input, select, textarea")).filter(visible).forEach((ct) => {
      const k = controlKey(ct);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(ct);
    });
    const boxes = [];
    document.querySelectorAll(REPEAT_BOX).forEach((b) => {
      if (b.parentElement && b.parentElement.closest(REPEAT_BOX)) return;
      boxes.push({ box: b, text: repeatBoxText(b) });
    });
    c.repeat = { byKey, boxes };
    return c.repeat;
  }
  function repeatInfo(label, element) {
    const sectionKey = (el) => (mapper && mapper.sectionOf ? mapper.sectionOf(el).key : "");
    const ctx = repeatContext();
    /* the box's own visible label too: a box's accessible name ("Applicant
     * first name") can differ from the label every card shows */
    const ownBox = element && element.closest ? element.closest(REPEAT_BOX) : null;
    const names = [normText(label), ownBox ? repeatBoxText(ownBox) : ""].filter(Boolean);
    let repeatSections = [];
    ctx.boxes.forEach((entry) => {
      if (entry.text && names.indexOf(entry.text) >= 0) repeatSections.push(sectionKey(entry.box));
    });
    /* boxes sharing this control's key are the same field on every card */
    if (element) {
      const same = ctx.byKey.get(controlKey(element)) || [];
      // Native controls with different keys can share a caption (the four
      // home system update years). Only twins of this control are rows.
      if (same.length) repeatSections = same.map(sectionKey);
    }
    const parts = String(document.title || "").split(" - ");
    return { repeats: repeatSections.length, repeatSections, page: parts.length > 1 ? normText(parts[parts.length - 1]).slice(0, 40) : "" };
  }

  /* mapping editor's view of this frame: every visible control with its key,
   * visible label, what auto-matching would pick, and any saved mapping */
  function scanControls(payload, overrides) {
    const ov = overrides || {};
    const candidates = payload ? mapper.buildCandidates(payload) : [];
    const rows = [];
    const seen = new Set();
    /* saved keys of controls that now carry their own key: the key stays a
     * row of its own (below) so a Save writes it back untouched */
    const legacyShared = new Map();
    const scanRoot = globalThis.__bettersOneLead && typeof globalThis.__bettersCaptureRoot === "function" ? globalThis.__bettersCaptureRoot() : activeModal() || document;
    for (const element of pageControls(scanRoot, true)) {
      const name = fieldName(element);
      if (!name) continue;
      /* a box whose own-label key holds a mapping is listed under it even when
       * it is alone on the page and its current key is the legacy key, so a
       * Save keeps that mapping */
      const key = rowKeyOf(ov, element);
      const legacy = legacyControlKey(element);
      const inherited = legacyRefused(ov, element);
      // Identify explicitly taught disabled values without advertising an
      // ambiguous old shared key as a mapping for its disabled siblings.
      if ((element.disabled || element.readOnly) && (!ov[key] || inherited)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      if (legacy !== key) {
        const hit = legacyShared.get(legacy) || { element, count: 0 };
        hit.count += 1;
        legacyShared.set(legacy, hit);
      }
      const payment = PAYMENT_FIELD.test(name);
      const auto = payment || inherited || !candidates.length ? null : mapper.matchField(name, candidates);
      const autoPath = auto && typeof auto.path === "string" && auto.path.indexOf("fields.") !== 0 ? auto.path : null;
      rows.push({
        key,
        label: (inSection(element, shownLabel(element) || clean(element.getAttribute("placeholder")) || clean(element.name) || clean(element.id)) || key) +
          (inherited ? " (re-teach: the old shared mapping is not applied)" : ""),
        fieldLabel: shownLabel(element) || "",
        ...repeatInfo(shownLabel(element) || "", element),
        section: mapper && mapper.sectionOf ? mapper.sectionOf(element).key : "",
        type: element.tagName === "SELECT" ? "select" : (element.type || "text").toLowerCase(),
        payment,
        autoPath,
        /* a box the old shared key is refused on shows no mapping of its own
         * (the old key's row below carries it and is flagged), so a Save does
         * not copy it */
        mapped: inherited ? "" : typeof ov[key] === "string" ? ov[key] : null,
        ...(inherited ? { needsReteach: true } : {}),
        options: choiceOptions(element)
      });
    }
    legacyShared.forEach((hit, legacy) => {
      if (seen.has(legacy) || typeof ov[legacy] !== "string" || !ov[legacy]) return;
      seen.add(legacy);
      const el = hit.element;
      rows.push({
        key: legacy,
        label: "Every box sharing " + (clean(el.name) || clean(el.id)) + " (saved before the boxes were told apart: not applied, re-teach each box under its own label)",
        needsReteach: true,
        fieldLabel: "",
        section: mapper && mapper.sectionOf ? mapper.sectionOf(el).key : "",
        type: el.tagName === "SELECT" ? "select" : (el.type || "text").toLowerCase(),
        payment: false,
        autoPath: null,
        mapped: ov[legacy],
        options: undefined
      });
    });
    // Read-only values must be discoverable BEFORE a mapping has been saved.
    const readable = typeof globalThis.__bettersCaptureElements === "function" ? globalThis.__bettersCaptureElements() : [];
    for (const element of readable) {
      if (element.matches("input,select,textarea,[role='combobox'],[role='checkbox'],[role='switch']") || !visible(element) || !textPickable(element)) continue;
      const label = inferTextLabel(element);
      if (!label) continue;
      const key = "pick:" + cssPath(element);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, label, type:"text", payment:PAYMENT_FIELD.test(label), autoPath:null, mapped:typeof ov[key] === "string" ? ov[key] : null });
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
      const family = m[2].indexOf(">") > 0 && /\[\](?:\.|$)/.test(String(ov[key] || ""));
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
    var question = el.closest && el.closest("icq-question");
    var questionCaption = question && question.querySelector(":scope > label");
    if (questionCaption) return clean(questionCaption.innerText || questionCaption.textContent).slice(0, 140);
    var amount = el.closest && el.closest(".coverage-amount");
    var prior = amount && amount.previousElementSibling;
    var caption = prior && prior.querySelector("mat-label, label");
    if (caption) return clean(caption.innerText || caption.textContent) + ": Amount";
    const local = typeof globalThis.__bettersLocalTextLabel === "function" ? globalThis.__bettersLocalTextLabel(el) : "";
    if (local) return local;
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
    if (prev && /^(STRONG|B|LABEL|DT|TH|SPAN|DIV|LI)$/.test(prev.tagName)) {
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
  var FIELD_BOX = "mat-form-field, .mat-mdc-form-field, .mat-form-field, .k-floating-label-container, ez-read-only-field";
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
      /* never climb out of the labelled field box that was clicked: a styled
       * dropdown (mat-select) has no input of its own, and the next one up
       * belongs to a NEIGHBOURING field (EZLynx "Address State" sits beside
       * the ZIP code). It is picked by its own label below instead. */
      if (node.matches && node.matches(FIELD_BOX)) break;
    }
    /* no control anywhere near - read-only text (AMS details pages):
     * teachable as a capture source */
    for (i = 0; i < path.length; i += 1) {
      var textEl = textPickable(path[i]);
      if (textEl) return { control: null, textEl: textEl, box: textEl };
    }
    return null;
  }

  function pickField(timeoutMs, overrides) {
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
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("mousedown", onPointerDown, true);
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

      function onPointerDown(event) {
        // Selection must not focus/open the source control before the click
        // is intercepted (address autocomplete can otherwise edit the form).
        if (!pickTarget(event)) return;
        event.preventDefault();
        event.stopPropagation();
      }

      function onClick(event) {
        var t = pickTarget(event);
        if (!t) return;
        event.preventDefault();
        event.stopPropagation();
        if (t.control) {
          var el = t.control;
          var name = fieldName(el) || "";
          var plain = shownLabel(el) || clean(el.getAttribute("placeholder")) || clean(el.name) || clean(el.id);
          var rep = repeatInfo(plain, el);
          var pickedKey = rowKeyOf(overrides || {}, el);
          finish({
            key: pickedKey,
            label: inSection(el, plain) || pickedKey,
            fieldLabel: plain,
            repeats: rep.repeats,
            repeatSections: rep.repeatSections,
            page: rep.page,
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
          var labelKey = boxLabel ? boxLabel.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
          // A truncated label cannot match the full source question later.
          // Long carrier captions use the stable control selector instead.
          if (labelKey.length > 140) labelKey = "";
          /* a sub-section's field ("Other Address" City) is its own mapping,
           * never its twin's in the other section */
          var sec = mapper && mapper.sectionOf ? mapper.sectionOf(tx) : { key: "", text: "" };
          var pickedPage = /(?:^| )address$/.test(sec.key) ? repeatInfo(boxLabel).page : "";
          finish({
            key: labelKey && !isSensitiveSource(boxLabel) ? "field:" + (pickedPage ? pickedPage + "|" : "") + (sec.key ? sec.key.slice(0, 40) + ">" : "") + labelKey : "pick:" + cssPath(tx),
            label: (labelKey && inSection(tx, boxLabel)) || boxLabel || hostLabel || ((inferred ? inferred + ": " : "") + snippet),
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
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("mousedown", onPointerDown, true);
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
    focused: { outline: "4px solid #ff00ff", badge: "#d000a8" },
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
  var PEEK_COLORS = /rgb\((19, 161, 14|15, 108, 189|138, 136, 134|209, 52, 56|255, 0, 255)\)|#(13a10e|0f6cbd|8a8886|d13438|ff00ff)/i;
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
    // A service mapping and a page mapping may cover the same element.
    // Keep one original style so clearing the selected pink outline restores it.
    var existing = peekMarks.find(function (m) { return m.el === el; });
    if (existing) {
      el.style.outline = s.outline;
      existing.focused = kind === "focused";
      if (existing.badge) {
        existing.badge.style.background = s.badge;
        if (label) existing.badge.textContent = label;
      }
      return;
    }
    var mark = { el: el, outline: el.style.outline, offset: el.style.outlineOffset, badge: null, focused: kind === "focused" };
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
      var ok = labelKeyOf(el);
      if (ok && ok !== k) (byKey[ok] = byKey[ok] || []).push(el);
    });
    var shown = 0;
    var missing = 0;
    // Selected fields are painted last so overlapping mappings stay pink.
    items = items.filter(function (it) { return !it || !it.focused; }).concat(items.filter(function (it) { return it && it.focused; }));
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
        markPeek(el, it.focused ? "focused" : it.kind, i === 0 ? String(it.label || "") + (it.array && els.length > 1 ? " (" + els.length + " rows)" : "") : "");
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
  var lastFocusedKey = "";
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
    var focusedKey = items.filter(function (it) { return it && it.focused; }).map(function (it) { return it.key; }).join("|");
    var r = peek(items, true);
    var map = {};
    Object.keys((arg && arg.map) || {}).forEach(function (k) { map[k] = arg.map[k]; });
    items.forEach(function (it) { if (it && typeof it.key === "string") map[it.key] = map[it.key] || (it.family ? "family" : "shown"); });
    var u = peekUnmapped({ map: map, payload: arg && arg.payload, pageLabels: arg && arg.pageLabels }, true);
    if (focusedKey && focusedKey !== lastFocusedKey) {
      var selected = peekMarks.find(function (m) { return m.focused; });
      if (selected && typeof selected.el.scrollIntoView === "function") selected.el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    lastFocusedKey = focusedKey;
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
      if (isControl && (coveredKeys.has(controlKey(el)) || coveredKeys.has(labelKeyOf(el)))) return;
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
  globalThis.__bettersPortalChoices = (key, labels, hint) =>
    (typeof key === "string" && key) || Array.isArray(labels) ? readChoices(typeof key === "string" ? key : "", labels, hint || null) : null;
  /* shared with the ingester, so a control's saved mapping routes its value
   * on capture exactly as it does on fill */
  globalThis.__bettersControlKey = controlKey;
  globalThis.__bettersSavedKey = savedKeyOf;
  globalThis.__bettersIsSensitiveLabel = isSensitiveSource;
  globalThis.__bettersPortalScan = (payload, overrides) => scanControls(payload, overrides || {});
  globalThis.__bettersPortalPick = (timeoutMs, overrides) => pickField(timeoutMs, overrides || {});
  globalThis.__bettersPortalPickCancel = () => { if (activePickCancel) activePickCancel(); };
})();
