/* Generic insured-data harvester, injected on demand into a carrier page the
 * user granted (the inverse of portal-fill.js). Reads what is VISIBLE on the
 * current page only - form controls, yes/no groups, definition lists, two-cell
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

  /* visible INCLUDING ancestors: a cell's own style says nothing about its
   * hidden row, and a hidden cell still returns its textContent */
  function shown(element) {
    if (!isVisible(element)) return false;
    for (let n = element.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    return true;
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
    for (let hops = 0; hops < 5 && node.parentElement; hops += 1) {
      node = node.parentElement;
      if (node.matches("form, main, body, section")) break;
      /* prefer an explicit, VISIBLE heading/label in this ancestor */
      for (const h of node.querySelectorAll("legend, label, h1, h2, h3, h4, h5, h6")) {
        if (h.contains(control) || !isVisible(h) || !h.getClientRects().length) continue;
        const t = clean(h.innerText);
        if (t.length >= 3 && t.length <= 140) return t;
      }
      /* else: the first visible short text that PRECEDES the control (SPA
       * design systems render the question as a plain span/div above the
       * input). Live nodes only - cloned/detached innerText degrades to
       * textContent and picks up hidden svg titles ("Search icon"). */
      for (const el of node.querySelectorAll("span, p, div")) {
        if (el === control || el.contains(control) || !isVisible(el) || !el.getClientRects().length) continue;
        if (el.closest("button, a, svg")) continue;
        if (!(control.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
        const own = clean(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
        if (own.length >= 3 && own.length <= 140) return own;
      }
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
      /* custom comboboxes (GEICO's finance-company picker) keep their whole
       * option list in the DOM, often off-screen rather than display:none -
       * innerText then returns EVERY option. Read the selected option, else
       * the wrapper text with list parts stripped, and never accept a value
       * that is plainly a list. */
      const selected = control.querySelector("[aria-selected='true']");
      if (selected) return clean(text(selected));
      const cloned = control.cloneNode(true);
      cloned.querySelectorAll("[role='listbox'], [role='option'], option, ul, ol, li").forEach((x) => x.remove());
      const v = clean(control.getAttribute("data-value") || cloned.innerText || cloned.textContent);
      return v.length > 120 ? "" : v;
    }
    return clean(control.value || control.getAttribute("value"));
  }

  /* banking, payment and card data is never captured */
  const PAYMENT_FIELD = /\b(bank|routing|account\s*(no|num|number)|iban|swift|card\s*(no|num|number)?|credit\s*card|debit|cvv|cvc|pay\s*method|method\s*of\s*payment|eft|ach)\b/i;
  const PAYMENT_CONTEXT = /\b(bank|routing|account\s*(no|num|number)|iban|swift|card\s*(no|num|number)|credit\s*card|debit|cvv|cvc|pay\s*method|method\s*of\s*payment|eft|ach)\b/i;

  /* identifier-class data (SSN, ITIN, passport) is never captured into the
   * application: only a control the agent mapped to a SECURED target lifts
   * it, onto the separate pass-through channel. Mirrors fieldMaps.ts. */
  const SENSITIVE_LABEL = /(?<![a-z])(ssns?|ss ?num(ber)?|soc(ial)? ?sec(urity)?|itins?|passports?)(?![a-z])/i;
  function sensitiveLabel(label) {
    const spaced = String(label || "").toLowerCase();
    return SENSITIVE_LABEL.test(spaced) || /(socialsecurity|socsec|ssnum|passport)/.test(spaced.replace(/[^a-z]/g, ""));
  }
  const SSN_SHAPE = /\b\d{3}[\s.-]\d{2}[\s.-]\d{4}\b/;
  function identifierField(f) {
    return sensitiveLabel(f.label) || sensitiveLabel(f.name) || SSN_SHAPE.test(String(f.value || ""));
  }
  const isSecurePath = (p) => typeof p === "string" && p.indexOf("secure:") === 0;

  /* cookie/consent widgets contribute nothing but noise */
  function inConsentUi(element) {
    return Boolean(element.closest("[id*='onetrust'], [class*='onetrust'], [id*='cookie'], [class*='cookie-banner'], [id*='consent'], [aria-label*='consent' i]"));
  }

  /* an OPEN MODAL owns the page: reading (or filling) behind it mixes OTHER
   * records - e.g. Tivly's whole lead list behind its Lead Details dialog */
  function activeModal() {
    const junk = /qsi|qualtrics|intercom|drift|zendesk|launcher|chat|feedback|survey|beacon|usabilla|hotjar|walkme|pendo/i;
    const candidates = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], [class*='modal']"))
      .filter((el) => isVisible(el) && el.getClientRects().length &&
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

  /* a heading's OWN words: AMS title bars carry their toolbar inside the
   * heading element ("Dittrich, Tracey SEND CERTIFICATE RATE! ACTIONS EDIT"),
   * so text inside buttons, menus and toolbars is left out */
  const HEADING_CHROME = "button, select, input, textarea, svg, [role='button'], [role='menu'], [role='menubar'], [role='toolbar'], [class*='btn'], [class*='dropdown'], [class*='toolbar']";
  function headingText(el) {
    if (!el) return "";
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!p || !isVisible(p)) continue;
      const chrome = p.closest(HEADING_CHROME);
      if (chrome && chrome !== el && el.contains(chrome)) continue;
      parts.push(n.textContent);
    }
    return clean(parts.join(" "));
  }

  function pageSection(scope) {
    for (const root of [scope || document, document]) {
      for (const h of root.querySelectorAll("h1, h2, h3, [class*='title']")) {
        if (!isVisible(h)) continue;
        const t = headingText(h);
        if (t.length >= 2 && t.length <= 80) return t;
      }
    }
    return location.hostname;
  }

  /* data-grid and toolbar chrome is not insured data: row selectors, "Select
   * All", per-row Actions menus, view settings (Show Archived, Page Size).
   * Only checkboxes/dropdowns are judged by placement - editable TEXT inputs
   * inside grids (driver/vehicle tables on quote forms) are real data. */
  const GRID_CHROME_LABEL = /^(select( all)?( rows?)?|select row|actions?|show (archived|inactive|deleted|all)|page size|rows per page|items per page|per page|show entries|sort( by)?|group by|columns?)$/i;
  function isGridChrome(control, label) {
    if (GRID_CHROME_LABEL.test(clean(label))) return true;
    const type = (control.getAttribute("type") || "").toLowerCase();
    const role = (control.getAttribute("role") || "").toLowerCase();
    const choice = control.tagName === "SELECT" || type === "checkbox" || ["checkbox", "switch", "combobox"].includes(role);
    if (!choice) return false;
    if (control.closest("[role='grid'], [role='treegrid'], [role='toolbar'], thead, [class*='k-grid'], [class*='toolbar'], [class*='pager'], [class*='pagination'], [class*='dataTables']")) return true;
    /* a table with 2+ rows of 3+ cells is a data grid; forms laid out as
     * label/value tables have 2 cells per row and keep their controls */
    const table = control.closest("table");
    if (!table) return false;
    let wideRows = 0;
    table.querySelectorAll("tr").forEach((r) => { if (r.querySelectorAll(":scope > td, :scope > th").length >= 3) wideRows += 1; });
    return wideRows >= 2;
  }

  /* --- data grids (Vehicles, Drivers, Policies, Contacts lists): captured
   * as ARRAYS. Every row becomes fields grouped "Row N" under the grid's own
   * title, labeled with the grid's own column headers, so the panel can show
   * the grid as its own table and nothing is flattened or lost. --- */
  const MAX_GRIDS = 8;
  const MAX_GRID_ROWS = 50;

  function titleCase(t) {
    return t === t.toUpperCase() && /[A-Z]/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
  }

  /* the grid's column headers: its own header row, or (split-header grids
   * such as Kendo) the header table that sits beside the body table */
  function gridHeaders(table) {
    const own = table.querySelector(":scope > thead > tr:last-child") ||
      Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr")).find((r) => r.querySelector(":scope > th"));
    if (own && own.querySelector(":scope > th")) {
      return { row: own, headers: Array.from(own.querySelectorAll(":scope > th, :scope > td")).map(headingText) };
    }
    /* Kendo (NowCerts) puts the header table ~5 levels above the body
     * table; the header row must have exactly as many cells as a data row */
    const sample = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr")).find((r) => r.querySelector(":scope > td"));
    const want = sample ? sample.querySelectorAll(":scope > td").length : 0;
    let node = table.parentElement;
    for (let hops = 0; node && hops < 7; hops += 1, node = node.parentElement) {
      for (const other of node.querySelectorAll("table")) {
        if (other === table || other.contains(table) || table.contains(other) || !other.querySelector("th")) continue;
        const row = other.querySelector("thead > tr:last-child") || other.querySelector("tr");
        const cells = row ? row.querySelectorAll(":scope > th, :scope > td") : [];
        if (want && cells.length === want) return { row: null, headers: Array.from(cells).map(headingText) };
      }
    }
    return null;
  }

  /* the grid's name: the closest heading/panel title BEFORE it */
  function gridTitle(table, n) {
    const caption = table.querySelector(":scope > caption");
    if (caption && headingText(caption)) return titleCase(headingText(caption));
    /* NowCerts' panel title (H4 "Vehicles List") sits ~10 levels above the
     * Kendo body table; the first ancestor holding a preceding title wins */
    let node = table;
    for (let hops = 0; hops < 12; hops += 1) {
      node = node.parentElement;
      if (!node) break;
      let best = "";
      node.querySelectorAll("h1, h2, h3, h4, h5, h6, legend, [class*='title'], [class*='header'], [class*='caption']").forEach((c) => {
        if (c.contains(table) || c.closest("table") || c.querySelector("table")) return;
        if (!(c.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
        const t = headingText(c);
        if (t.length >= 2 && t.length <= 60) best = t;
      });
      if (best) return titleCase(best);
    }
    return "Table " + n;
  }

  /* a taught value's label, read from the page: its grid column header,
   * the left cell of a label/value row, or the text just before it */
  function noteLabel(el) {
    if (!el) return "";
    const cell = el.closest("td, th");
    if (cell && cell.parentElement) {
      const row = cell.parentElement;
      const idx = Array.prototype.indexOf.call(row.children, cell);
      const table = cell.closest("table");
      const head = table ? gridHeaders(table) : null;
      if (head && head.headers.length === row.children.length && clean(head.headers[idx])) return clean(head.headers[idx]);
      if (row.children.length === 2 && row.children[1] === cell) return clean(text(row.children[0])).replace(/[:*]+$/, "");
    }
    const prev = el.previousElementSibling;
    const p = prev ? clean(text(prev)).replace(/[:*]+$/, "") : "";
    if (p && p.length <= 60) return p;
    return clean(el.getAttribute("aria-label") || el.getAttribute("title") || "");
  }

  /* REPEATED FORM CARDS (Vehicle 1 / Vehicle 2, Driver 1 / Driver 2): the
   * same labelled field once per card. These helpers find a field's label,
   * its counterparts in the other cards, and the cards' shared title, so
   * every mapped field of a card lands in ONE table row. */
  const FORM_FIELD = "mat-form-field, .mat-form-field, .mat-mdc-form-field, .k-floating-label-container, .form-group, .form-field, .field";
  function stripMarks(s) { return clean(s).replace(/^[*\s]+|[:*\s]+$/g, ""); }

  /* the label of the field an element belongs to ("Year", never "*Year"
   * and never the value it shows) */
  function fieldLabelOf(el) {
    if (!el) return "";
    const ff = el.closest(FORM_FIELD);
    if (ff) {
      const lab = ff.querySelector("label, mat-label, .k-label, legend");
      const t = lab ? stripMarks(text(lab)) : "";
      if (t && t.length <= 60) return t;
    }
    const control = el.matches("input, select, textarea") ? el : el.closest("[role='combobox'], select");
    if (control && control.matches("input, select, textarea")) {
      const t = stripMarks(labelFor(control));
      if (t && t.length <= 60) return t;
    }
    return "";
  }

  /* an element's value: a control's value (a select's chosen text), or text */
  function valueOf(el) {
    if (el.matches("select")) { const o = el.options[el.selectedIndex]; return o ? clean(o.textContent) : ""; }
    if (el.matches("input, textarea")) return clean(el.value);
    const inner = el.matches(FORM_FIELD) ? el.querySelector("input, select, textarea") : null;
    if (inner) return valueOf(inner);
    return text(el);
  }

  /* the same field in every card: same form-field kind, same label, value
   * element at the same position inside it. Null unless it repeats. */
  function siblingsByLabel(anchor) {
    const ff = anchor && anchor.closest(FORM_FIELD);
    const label = fieldLabelOf(anchor);
    if (!ff || !label) return null;
    const path = [];
    for (let n = anchor; n && n !== ff; n = n.parentElement) path.unshift(Array.prototype.indexOf.call(n.parentElement.children, n));
    const kind = ff.tagName + "." + String(ff.className).split(/\s+/)[0];
    const out = [];
    document.querySelectorAll(FORM_FIELD).forEach((f) => {
      if (f.tagName + "." + String(f.className).split(/\s+/)[0] !== kind || !isVisible(f)) return;
      const lab = f.querySelector("label, mat-label, .k-label, legend");
      if (!lab || stripMarks(text(lab)) !== label) return;
      let el = f;
      for (const i of path) { el = el && el.children[i]; }
      out.push(el || f);
    });
    return out.length >= 2 ? out : null;
  }

  /* what the repeated cards are called ("Vehicle 1", "Vehicle 2" ->
   * "Vehicles"), from the first card's own heading text */
  function repeatTitle(els) {
    if (!els || els.length < 2) return "";
    let card = els[0];
    while (card.parentElement && !card.parentElement.contains(els[1])) card = card.parentElement;
    const scan = [card];
    for (let p = card.previousElementSibling, i = 0; p && i < 3; p = p.previousElementSibling, i += 1) scan.push(p);
    for (const root of scan) {
      for (const n of [root].concat(Array.from(root.querySelectorAll("*")))) {
        const own = clean(Array.from(n.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join(" "));
        const m = own.match(/^([A-Za-z][A-Za-z ]{1,30}?)\s*#?\s*1$/);
        if (m) return /s$/i.test(m[1]) ? m[1] : m[1] + "s";
      }
    }
    return "";
  }

  /* LABELLED-FIELD keys ("field:vehicles|vin"): a field named by its label,
   * on the page whose title names that step, in every card. Robust where
   * selectors are not (re-rendered widgets, generated ids) and the same for
   * every applicant and agent - so they share well. */
  function labelKey(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  /* the page's own name: "Tracy Dittrich - Vehicles" -> "Vehicles" */
  function pageTitle() {
    const parts = String(document.title || "").split(" - ");
    const t = clean(parts[parts.length - 1]);
    return parts.length > 1 && t && t.length <= 40 ? t : pageSection(activeModal());
  }
  /* a field's sub-section ("other address"; "" outside one), shared with
   * the filler so keys agree everywhere */
  function sectionOf(el) {
    const m = globalThis.BettersPortalMapper;
    return m && m.sectionOf ? m.sectionOf(el) : { key: "", text: "" };
  }
  /* the policy type a step belongs to: EZLynx rating steps are headed by
   * their line ("Auto", "Home") and titled by the step ("Policy Info"), so
   * Auto's prior carrier and Home's are separate tables, never one */
  function lobHeading() {
    const m = globalThis.BettersPortalMapper;
    return m && m.pageHeadingText ? m.pageHeadingText() : "";
  }
  function withHeading(title) {
    const h = lobHeading();
    if (!h || !title) return title || h;
    return labelKey(title).indexOf(labelKey(h)) === 0 ? title : h + ": " + title;
  }
  /* the line of business a page is headed by ("Auto", "Home", "Dwelling
   * Fire"...), "" when the heading isn't one */
  var LINE = /\b(auto|home|homeowners?|dwelling|fire|renters?|condo|umbrella|motorcycle|boat|watercraft|yacht|rv|motorhome|flood|earthquake|landlord|mobile home|manufactured|farm|ranch|commercial|business|bop|liability|workers|inland marine|personal articles|scheduled personal property|jewelry|life|health)\b/i;
  function lineOfPage() {
    const h = lobHeading();
    return h && LINE.test(h) && h.length <= 30 ? h : "";
  }
  /* WHAT a single value on a line's page describes: the prior policy, the
   * new policy being quoted, or just the step - "Prior Auto Policy" /
   * "New Auto Policy" are the entities the values will one day map to */
  function policyTable(label) {
    const line = lineOfPage();
    if (!line) return "";
    const l = String(label || "");
    if (/\bprior\b|continuous coverage|current (carrier|insurer|policy)/i.test(l)) return "Prior " + line + " Policy";
    if (/\bnew policy\b|quote as package|underwriting reports|effective date|policy term/i.test(l)) return opportunityPolicy(line);
    return "";
  }
  function sectionFor(label) { return policyTable(label) || stepTitle(); }
  /* "Auto: Policy Info" - only when the page names its step in the tab
   * title ("Name - Step") or has a heading; "" otherwise */
  function stepTitle() {
    const parts = String(document.title || "").split(" - ");
    const step = parts.length > 1 ? clean(parts[parts.length - 1]) : "";
    return step && step.length <= 40 ? stepTable(step) : lobHeading();
  }
  /* the policy being quoted is the opportunity's: "Opportunity Policy - Auto" */
  function opportunityPolicy(line) { return "Opportunity Policy - " + line; }
  /* a step's table: the line's Policy Info step is the opportunity's policy,
   * other steps "Auto: Drivers" */
  function stepTable(step) {
    const line = lineOfPage();
    return line && /\bpolic(y|ies)\b/i.test(step) ? opportunityPolicy(line) : withHeading(step);
  }

  /* "other address>city": only that section's City; plain "city": every
   * one. family: every section of the same kind ("primary address",
   * "other address", "mailing address" all end in "address") - an ARRAY
   * mapping on one card's field takes every card's, one row each */
  function lastWord(s) { const w = String(s || "").trim().split(" "); return w[w.length - 1] || ""; }
  function fieldsByLabel(full, family) {
    const at = String(full || "").indexOf(">");
    const section = at < 0 ? "" : full.slice(0, at);
    const els = labelledBoxes(at < 0 ? full : full.slice(at + 1));
    if (!section) return els;
    const kind = lastWord(section);
    return els.filter((el) => {
      const s = sectionOf(el).key;
      return family ? Boolean(s) && lastWord(s) === kind : s === section;
    });
  }
  function labelledBoxes(key) {
    const out = [];
    document.querySelectorAll(FORM_FIELD).forEach((f) => {
      if (!isVisible(f) || (f.parentElement && f.parentElement.closest(FORM_FIELD))) return;
      const lab = f.querySelector("label, mat-label, .k-label, legend");
      if (lab && labelKey(stripMarks(text(lab))) === key) out.push(f);
    });
    if (!out.length) {
      document.querySelectorAll("input, select, textarea").forEach((c) => {
        const type = (c.getAttribute("type") || "").toLowerCase();
        if (isVisible(c) && SKIP_TYPES.indexOf(type) < 0 && labelKey(stripMarks(labelFor(c))) === key) out.push(c);
      });
    }
    return inPageOrder(out);
  }
  function fieldValue(el) {
    if (el.matches("input, select, textarea")) return valueOf(el);
    const shownChoice = el.querySelector(".mat-mdc-select-value-text, .mat-select-value-text, .k-input-value-text, mat-select, [role='combobox']:not(input)");
    if (shownChoice) return text(shownChoice);
    const c = el.querySelector("input, select, textarea");
    return c ? valueOf(c) : "";
  }
  function fieldLabelText(el) {
    if (el.matches("input, select, textarea")) return stripMarks(labelFor(el));
    const lab = el.querySelector("label, mat-label, .k-label, legend");
    return lab ? stripMarks(text(lab)) : "";
  }

  /* rows in page order, renumbered 1..n so columns from different fields
   * of the same cards line up */
  function inPageOrder(els) {
    return els.slice().sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  function cellValue(td) {
    const t = clean(headingText(td).replace(/(^|\s)\+(?=\s|$)/g, " ")).replace(/\s+,/g, ",").replace(/,$/, "");
    if (t) return t;
    const box = td.querySelector("input[type='checkbox'], [role='checkbox']");
    if (box) return box.checked === true || box.getAttribute("aria-checked") === "true" ? "Yes" : "No";
    return "";
  }

  /* every captured grid cell: {title, row (1-based), label, td, value} -
   * shared by the capture and the "peek unmapped" overlay */
  function gridCells(root) {
    const out = [];
    let n = 0;
    for (const table of root.querySelectorAll("table")) {
      if (n >= MAX_GRIDS) break;
      if (!isVisible(table) || inConsentUi(table)) continue;
      const head = gridHeaders(table);
      if (!head) continue;
      const headers = head.headers.map((h) => clean(h));
      if (headers.length < 3 || headers.filter(Boolean).length < 2) continue;
      const rows = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr"))
        .filter((r) => r !== head.row && isVisible(r) && r.querySelectorAll(":scope > td").length === headers.length);
      if (!rows.length) continue;
      n += 1;
      const title = gridTitle(table, n);
      rows.slice(0, MAX_GRID_ROWS).forEach((row, i) => {
        const cells = row.querySelectorAll(":scope > td");
        headers.forEach((label, c) => {
          if (!label || GRID_CHROME_LABEL.test(label) || PAYMENT_FIELD.test(label)) return;
          const value = cellValue(cells[c]).slice(0, 300);
          if (value) out.push({ title, row: i + 1, label, td: cells[c], value });
        });
      });
    }
    return out;
  }

  function collectGrids(root, fields) {
    gridCells(root).forEach((g) => {
      fields.push({ label: g.label, value: g.value, section: g.title, group: "Row " + g.row, source: "table" });
    });
  }

  function captureRoot() {
    return activeModal() || document.querySelector("main") || document;
  }

  const SKIP_TYPES = ["radio", "hidden", "password", "file", "submit", "button", "reset", "search"];

  /* the site's own chrome (header/nav search boxes) is never insured data */
  function siteChrome(control) {
    if (control.closest("header, nav, [role='banner'], [role='navigation'], [role='search']")) return true;
    return /^search\b/i.test(clean(control.getAttribute("placeholder") || control.getAttribute("aria-label") || ""));
  }

  /* the on-page elements a capture reads structurally (form controls, grid
   * cells, label/value rows, definition lists) - the "peek unmapped" overlay
   * outlines the ones no saved mapping covers */
  function captureElements() {
    const root = captureRoot();
    const els = [];
    root.querySelectorAll("input, select, textarea, [role='combobox'], [role='checkbox'], [role='switch']").forEach((c) => {
      if (!isVisible(c) || inConsentUi(c) || siteChrome(c) || SKIP_TYPES.includes((c.getAttribute("type") || "").toLowerCase())) return;
      const label = clean(labelFor(c));
      if (PAYMENT_FIELD.test(label) || isGridChrome(c, label)) return;
      els.push(c);
    });
    gridCells(root).forEach((g) => els.push(g.td));
    root.querySelectorAll("tr").forEach((row) => {
      if (!isVisible(row)) return;
      const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"));
      if (cells.length === 2 && text(cells[0]) && text(cells[1]) && text(cells[0]) !== text(cells[1])) els.push(cells[1]);
    });
    root.querySelectorAll("dd").forEach((dd) => { if (isVisible(dd) && text(dd)) els.push(dd); });
    return Array.from(new Set(els));
  }

  /* controlMap: the page's saved control mappings ({controlKey: target}),
   * so a mapped control routes its value on capture exactly as on fill;
   * secureOut collects values of controls mapped to SECURED targets */
  function collect(controlMap, secureOut) {
    const modal = activeModal();
    const section = pageSection(modal);
    const root = modal || document.querySelector("main") || document;
    const fields = [];
    const map = controlMap || {};
    const keyOf = typeof globalThis.__bettersControlKey === "function" ? globalThis.__bettersControlKey : null;
    const noteControls = [];

    Array.from(root.querySelectorAll("input, select, textarea, [role='combobox'], [role='checkbox'], [role='switch']"))
      .filter(isVisible)
      .filter((control) => !inConsentUi(control) && !siteChrome(control))
      .filter((control) => !["radio", "hidden", "password", "file", "submit", "button", "reset", "search"].includes((control.getAttribute("type") || "").toLowerCase()))
      .forEach((control) => {
        const label = clean(labelFor(control));
        if (PAYMENT_FIELD.test(label) || PAYMENT_FIELD.test(clean(control.name || control.id))) return;
        if (isGridChrome(control, label)) return;
        let path = null;
        if (keyOf && control.matches("input, select, textarea")) {
          try { path = map[keyOf(control)] || null; } catch (_e) { path = null; }
        }
        const value = valueFor(control);
        if (isSecurePath(path)) {
          if (value && secureOut) secureOut.push({ path, value });
          return;
        }
        const field = { label, value, name: clean(control.name || control.id), section: sectionOf(control).text || section, group: "", source: "control" };
        if (path && (/^(?:crm:[a-z]+\d*|[a-z][a-zA-Z0-9]{0,30})\.[a-z][a-zA-Z0-9_]{0,99}$/.test(path) ||
            NOTE_PATH.test(path))) field.mapped = path;
        if (field.mapped && /^note/.test(field.mapped)) noteControls.push({ field, control, key: keyOf(control) });
        fields.push(field);
      });
    /* one note mapping on a control that repeats per card (both vehicles'
     * VIN boxes share a key): rows of the cards' table, in page order */
    const byKey = new Map();
    noteControls.forEach((n) => { if (!byKey.has(n.key)) byKey.set(n.key, []); byKey.get(n.key).push(n); });
    byKey.forEach((group) => {
      if (group.length < 2) return;
      const ordered = inPageOrder(group.map((g) => g.control));
      const title = stepTable(repeatTitle(ordered) || pageTitle());
      ordered.forEach((control, i) => {
        const g = group.find((x) => x.control === control);
        g.field.group = "Row " + (i + 1);
        g.field.section = title;
        g.field.label = fieldLabelOf(control) || g.field.label;
        g.field.mapped = noteRow(g.field.mapped, i);
      });
    });
    /* a single control on the related-contact note: the first related contact */
    noteControls.forEach((n) => {
      n.field.mapped = noteRow(n.field.mapped, 0);
      if (!n.field.group && !sectionOf(n.control).text) n.field.section = sectionFor(n.field.label) || n.field.section;
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

    collectGrids(root, fields);

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
     * - premium summaries usually render as plain text, not form controls */
    root.querySelectorAll("div, li, p, span, dd, td").forEach((el) => {
      if (!isVisible(el) || el.children.length > 3 || inConsentUi(el)) return;
      const t = clean(el.innerText);
      const m = t.match(/^([A-Za-z0-9][A-Za-z0-9 /()&'.-]{2,70}?):?\s*(\$[\d,]+(?:\.\d{2})?)$/);
      if (m && /[A-Za-z]/.test(m[1])) {
        fields.push({ label: m[1], value: m[2], section, group: "", source: "money-line" });
        return;
      }
      /* reversed "amount label" form ("$516.80 Due Today") - short labels only,
       * so trailing button text ("Print Quote Proposal Next") doesn't ride along */
      const r = t.match(/^(\$[\d,]+(?:\.\d{2})?)\s+([A-Za-z][A-Za-z0-9 /()&'.-]{2,30})$/);
      if (r && r[2].split(" ").length <= 3) fields.push({ label: r[2], value: r[1], section, group: "", source: "money-line" });
    });

    /* label-left / value-right rows - servicing portals (GEICO Edge) print
     * facts as a container with exactly two text children ("Issuing State
     * (or Country)" | "MINNESOTA"). Guards keep navs and menus out. */
    root.querySelectorAll("div, li").forEach((row) => {
      if (!isVisible(row) || inConsentUi(row) || row.children.length !== 2) return;
      if (row.querySelector("input, select, textarea, button, a, svg, [role='combobox'], [role='radiogroup']")) return;
      const c0 = row.children[0], c1 = row.children[1];
      if (c0.children.length > 2 || c1.children.length > 3) return;
      const label = text(c0).replace(/[:*]+$/, "");
      const value = text(c1);
      if (!label || !value || label === value || label.length > 80 || value.length > 300) return;
      fields.push({ label, value, section, group: "", source: "review-row" });
    });

    /* bold-label prose runs - "<strong>Name Insured</strong> <span>Edward
     * Parkin</span> <br> <strong>Mailing Address</strong>…" - the standard
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

    /* "Label: value" LINES inside composite cells - Tivly's Lead Details
     * renders "Contact Name: Katsuyoshi Murano" as plain lines inside a
     * multi-line value cell, invisible to the row collectors */
    const lineSource = String((modal || document.body).innerText || "").split(String.fromCharCode(10)).slice(0, 400);
    for (const rawLine of lineSource) {
      const line = clean(rawLine);
      const m = line.match(/^([A-Za-z][A-Za-z /()'&#.-]{1,39}):\s+(.{1,200})$/);
      if (!m) continue;
      const label = m[1].trim();
      if (label.split(" ").length > 5 || PAYMENT_FIELD.test(label)) continue;
      fields.push({ label, value: m[2].trim(), section, group: "", source: "review-row" });
    }

    /* sale/confirmation facts are usually PROSE, not form fields ("GEICO Auto
     * Policy Number: 6277201270", "Your coverage is effective 9/27/2026",
     * "Your 6 Month Auto Premium is $922.00") - pattern-match the page text */
    const bodyText = clean(((modal || document.body).innerText || "").slice(0, 150000));
    const saleSeen = new Set();
    const salePush = (label, value) => {
      if (value && !saleSeen.has(label)) { saleSeen.add(label); fields.push({ label, value: clean(value), section, group: "", source: "sale" }); }
    };
    const pol = bodyText.match(/policy\s*(?:number|#)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,19})/i) ||
      /* servicing portals shorthand: "Auto #6277201270" */
      bodyText.match(/\b(?:auto|home|renters?|umbrella)\s*#\s*([A-Z0-9-]{5,15})\b/i);
    if (pol) salePush("Policy Number", pol[1]);
    /* raw VINs (17 chars, no I/O/Q) - servicing pages print them bare */
    let vinN = 0;
    /* a vehicles grid already carries its VINs with their vehicles */
    const gridVins = fields.some((f) => /^Row \d+$/.test(f.group) && /\bvin\b/i.test(f.label));
    for (const vm of gridVins ? [] : bodyText.matchAll(/(?:^|[\s#])([A-HJ-NPR-Z0-9]{17})(?=\s|$)/g)) {
      if (/[A-HJ-NPR-Z]/.test(vm[1]) && /\d/.test(vm[1])) {
        vinN += 1;
        if (vinN > 6) break;
        salePush(vinN === 1 ? "VIN" : "VIN " + vinN, vm[1]);
      }
    }
    /* a full US address printed as bare text ("203 WALL STREET EAST SAINT
     * LOUIS, IL 62206" under a confirmation heading) - no label structure */
    const addr = bodyText.match(/\b\d{1,6}\s+[A-Za-z0-9 .'#-]{3,60}?,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/);
    if (addr) salePush("Mailing Address", addr[0]);
    /* "Effective Dates 9/27/2026-03/27/2027" carries BOTH dates */
    const range = bodyText.match(/effective\s*dates?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*[-\u2013\u2014]\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (range) {
      salePush("Effective Date", range[1]);
      salePush("Expiration Date", range[2]);
    }
    const eff = bodyText.match(/(?:coverage is\s+)?effective(?:\s*date)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (eff) salePush("Effective Date", eff[1]);
    const exp = bodyText.match(/expiration(?:\s*date)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (exp) salePush("Expiration Date", exp[1]);
    /* bare policy-term range ("09/27/2026 - 03/27/2027") - only as a fallback
     * when no labeled dates were found on the page */
    const bare = bodyText.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-\u2013\u2014]\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (bare) {
      salePush("Effective Date", bare[1]);
      salePush("Expiration Date", bare[2]);
    }
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

    /* a "value" hundreds of characters long is a swallowed widget, not data;
     * confirm-dialog prompts and fully masked values are junk too */
    return fields.filter((field) =>
      field.label && field.value && field.value.length <= 300 &&
      !/are you sure|delete this/i.test(field.label) &&
      /* card references inside VALUES ("VISA Credit Card- Sales ending in 6060") */
      !(/\b(visa|mastercard|amex|american express|discover|credit card|debit card)\b/i.test(field.value) && /\d{4}/.test(field.value)) &&
      !/^[•*xX.-]{4,}$/.test(field.value));
  }

  function luhnOk(digits) {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let d = digits.charCodeAt(i) - 48;
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  /* a taught selector must not lift identifiers or payment data whatever
   * the taught CRM label says: separated-SSN shapes, Luhn-valid card
   * windows in any separator style, and very long contiguous digit runs
   * are refused by VALUE shape. FEIN (9 digits, "41-1234567" or bare) and
   * phones (10-11) stay capturable by design. */
  function taughtValueSafe(el, value) {
    /* element + 3 ancestors' ids/classes, camelCase split into words so the
     * boundary-anchored payment regex can see txtCreditCardNumber et al. */
    let ctx = "";
    let n = el;
    for (let hop = 0; n && n.getAttribute && hop < 4; hop += 1) {
      ctx += " " + (n.id || "") + " " + (typeof n.className === "string" ? n.className : "") + " " + (n.getAttribute("aria-label") || "");
      n = n.parentElement;
    }
    ctx = clean(ctx).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
    /* class names: a bare "card" is a layout card (mat-card, vehicle-card),
     * not a payment card - only card NUMBER/credit/debit wording counts here;
     * real card numbers are still caught by value (Luhn) below */
    if (PAYMENT_CONTEXT.test(ctx)) return false;
    /* SSN in any common separator style (FEIN's ##-####### shape differs) */
    if (/\b\d{3}[\s.-]\d{2}[\s.-]\d{4}\b/.test(value)) return false;
    if (/\d{16,}/.test(value)) return false;
    /* card detection: digit clusters joined by single separators, every
     * 13-19 digit window Luhn-checked (catches dotted/spaced groupings) */
    const runs = value.match(/\d(?:[\s.-]?\d){11,24}/g) || [];
    for (const run of runs) {
      const digits = run.replace(/[^0-9]/g, "");
      for (let win = 13; win <= 19; win += 1) {
        for (let i = 0; i + win <= digits.length; i += 1) {
          if (luhnOk(digits.slice(i, i + win))) return false;
        }
      }
    }
    return true;
  }

  /* agent-taught read-only-text extractions: {selector, label} pairs saved
   * via the mapping editor's picker ("this element's text IS the email").
   * Labels come from the worker's own CRM-field vocabulary, never the page. */
  /* Array relationships ("contacts[].email"): the plural names the CRM array,
   * slot/start name the per-row groups the capture fans out into (contact1 is
   * the primary insured, so related contacts start at 2). */
  /* timeline-note targets; "note:contacts[]" = each row's related contact
   * (row 1 -> note:contact2, like the related-contact slots) */
  var NOTE_PATH = /^note(:(contact|opportunity|quote|policy|contacts\[\]))?$/;
  function noteRow(path, i) { return path === "note:contacts[]" ? "note:contact" + (i + 2) : path; }
  var ARRAY_SLOTS = {
    contacts: { slot: "contact", start: 2 }, vehicles: { slot: "vehicle", start: 1 },
    /* CRM-column arrays share the semantic numbering, so a table taught with
     * a mix of both kinds of target stays row-aligned */
    "crm:contacts": { slot: "crm:contact", start: 2 }, "crm:policies": { slot: "crm:policy", start: 1 },
    /* row N = the insured's address number N (1 = Address 1 / primary) */
    "crm:addresses": { slot: "crm:address", start: 1 },
    /* the insured's assets: row N = the Nth vehicle / boat / property... */
    "crm:vehicles": { slot: "crm:vehicle", start: 1 }, "crm:watercraft": { slot: "crm:watercraft", start: 1 },
    "crm:properties": { slot: "crm:property", start: 1 }, "crm:equipment": { slot: "crm:equipment", start: 1 },
    "crm:scheduleditems": { slot: "crm:scheduleditem", start: 1 },
    /* records on an asset: mortgagees / lienholders, a property's history */
    "crm:additionalinterests": { slot: "crm:additionalinterest", start: 1 },
    "crm:propertyrenovations": { slot: "crm:propertyrenovation", start: 1 },
    "crm:propertylosses": { slot: "crm:propertyloss", start: 1 },
    "crm:propertyparties": { slot: "crm:propertyparty", start: 1 }
  };

  /* An array teaching's selector points at ONE row's cell. The repeating axis
   * is found mechanically: vary each :nth-of-type index OUTERMOST FIRST and
   * take the first axis with 2+ visible matches. The row element always sits
   * higher in the tree than the cells inside it, so outermost-first picks the
   * row axis even when a row's own cells repeat too (a 2-row table must
   * expand down the rows, not across its columns); spurious outer wrappers
   * break the chain immediately because their siblings lack the inner path.
   * Returns [{n, el}] keyed by the row's nth index (so sibling teachings from
   * other cells of the same table stay row-aligned even when a row hides one
   * cell), or null when nothing repeats. */
  function expandTaughtRows(selector) {
    const marks = [];
    const re = /:nth-of-type\((\d+)\)/g;
    let m;
    while ((m = re.exec(selector)) !== null) marks.push({ index: m.index, length: m[0].length });
    for (let i = 0; i < marks.length; i += 1) {
      const rows = [];
      for (let n = 1; n <= 30; n += 1) {
        const sel = selector.slice(0, marks[i].index) + ":nth-of-type(" + n + ")" + selector.slice(marks[i].index + marks[i].length);
        let el = null;
        try { el = document.querySelector(sel); } catch (_e) { break; }
        if (!el) break; /* nth-of-type runs are contiguous */
        rows.push({ n: n, el: el });
      }
      if (rows.filter(function (r) { return isVisible(r.el); }).length >= 2) return rows;
    }
    return null;
  }

  /* one labelled-field teaching ({byLabel, page, path, section}): only on
   * its own page; every card's instance, in page order; same routing as a
   * picked field (note table, list rows, or one routed value). Secured
   * targets never travel this way (share files can't carry them). */
  function labelledFields(t, out) {
    const path = typeof t.path === "string" ? t.path : "";
    if (!path || isSecurePath(path)) return;
    if (t.page && labelKey(pageTitle()) !== t.page) return;
    const els = fieldsByLabel(t.byLabel, /\[\]\./.test(path));
    if (!els.length) return;
    const label = clean(t.label) || fieldLabelText(els[0]) || t.byLabel;
    if (PAYMENT_FIELD.test(label) || sensitiveLabel(label)) return;
    const values = els.map((el) => {
      const v = fieldValue(el).slice(0, 300);
      return v && shown(el) && taughtValueSafe(el, v) ? v : "";
    });
    const multi = els.length > 1;
    const own = sectionOf(els[0]).text;
    if (NOTE_PATH.test(path)) {
      const section = multi ? stepTitle() : own || sectionFor(label) || "Notes";
      values.forEach((value, i) => { if (value) out.push({ label, value, section, group: multi ? "Row " + (i + 1) : "", source: "taught", mapped: noteRow(path, i) }); });
      return;
    }
    const arr = path.match(/^((?:crm:)?[a-z]+)\[\]\.([a-z][a-zA-Z0-9_]{0,99})$/);
    if (arr && ARRAY_SLOTS[arr[1]]) {
      const cfg = ARRAY_SLOTS[arr[1]];
      const section = clean(t.section) || pageTitle();
      values.forEach((value, i) => {
        if (value) out.push({ label, value, section, group: "Row " + (i + 1), source: "taught", mapped: cfg.slot + (cfg.start + i) + "." + arr[2] });
      });
      return;
    }
    if (values[0] && /^(?:crm:[a-z]+\d*|[a-z][a-zA-Z0-9]{0,30})\.[a-z][a-zA-Z0-9_]{0,99}$/.test(path)) {
      out.push({ label, value: values[0], section: own || sectionFor(label), group: "", source: "taught", mapped: path });
    }
  }

  function taughtFields(taught, secureOut) {
    const out = [];
    (Array.isArray(taught) ? taught : []).forEach((t) => {
      if (t && typeof t.byLabel === "string" && t.byLabel) { labelledFields(t, out); return; }
      if (!t || typeof t.selector !== "string" || typeof t.label !== "string" || PAYMENT_FIELD.test(t.label)) return;
      const path = typeof t.path === "string" ? t.path : "";
      let anchor = null;
      try { anchor = document.querySelector(t.selector); } catch (_e) { return; }
      const row = (el) => {
        if (!el || !shown(el)) return null;
        const value = valueOf(el).slice(0, 300);
        return value && taughtValueSafe(el, value) ? value : null;
      };
      /* the rows a teaching repeats over: a grid's rows as found; outside a
       * table, the same labelled field in every card (else the structural
       * repeat), renumbered in page order so a card's fields share a row */
      const repeated = () => {
        const found = expandTaughtRows(t.selector);
        if (found && found[0] && found[0].el.closest("table")) return found;
        const sib = anchor ? siblingsByLabel(anchor) : null;
        const els = sib || (found ? found.map((r) => r.el) : null);
        return els ? inPageOrder(els).map((el, i) => ({ n: i + 1, el })) : null;
      };
      if (isSecurePath(path)) {
        /* SECURED teaching: the value goes to the pass-through channel only
         * (never a capture field); payment data is still refused */
        const sec = (el) => {
          if (!el || !shown(el)) return null;
          const value = text(el).slice(0, 100);
          return value && !PAYMENT_FIELD.test(value) ? value : null;
        };
        const arrSec = path.match(/^secure:contacts\[\]\.([a-z][a-z0-9_]{0,99})$/);
        if (arrSec) {
          (expandTaughtRows(t.selector) || (anchor ? [{ n: 1, el: anchor }] : [])).forEach((r) => {
            const value = sec(r.el);
            if (value && secureOut) secureOut.push({ path: "secure:contact" + (r.n + 1) + "." + arrSec[1], value });
          });
          return;
        }
        const value = sec(anchor);
        if (value && secureOut) secureOut.push({ path, value });
        return;
      }
      if (NOTE_PATH.test(path)) {
        /* identifier data can never become a timeline note */
        if (sensitiveLabel(t.label) || (anchor && sensitiveLabel(noteLabel(anchor)))) return;
        /* timeline-note teaching ("note" = insured account, "note:<record>"
         * otherwise): on a grid cell, the whole column (every row, under the
         * grid's title and real header); else the one value */
        const rows = repeated() || (anchor ? [{ n: 1, el: anchor }] : []);
        const multi = rows.length > 1;
        const first = rows[0] && rows[0].el;
        const label = clean(t.label) || fieldLabelOf(first) || noteLabel(first) || "Note";
        const table = multi && first ? first.closest("table") : null;
        const section = table ? gridTitle(table, 0)
          : multi ? withHeading(repeatTitle(rows.map((r) => r.el)) || pageTitle()) : sectionFor(label) || "Notes";
        rows.forEach(function (r) {
          const value = row(r.el);
          if (value) out.push({ label, value, section, group: multi ? "Row " + r.n : "", source: "taught", mapped: noteRow(path, r.n - 1) });
        });
        return;
      }
      const arr = path.match(/^((?:crm:)?[a-z]+)\[\]\.([a-z][a-zA-Z0-9_]{0,99})$/);
      if (arr && ARRAY_SLOTS[arr[1]]) {
        /* array teaching: pull the taught cell from EVERY repeated row, as
         * table rows under the record type ("Related contacts" | Row N |
         * "First Name"), so every array shows as its own table */
        const cfg = ARRAY_SLOTS[arr[1]];
        const rows = repeated() || (anchor ? [{ n: 1, el: anchor }] : []);
        const section = clean(t.section) || "Records";
        rows.forEach(function (r) {
          const value = row(r.el);
          if (!value) return;
          out.push({ label: t.label, value, section, group: "Row " + r.n, source: "taught",
            mapped: cfg.slot + (cfg.start + r.n - 1) + "." + arr[2] });
        });
        return;
      }
      const value = row(anchor);
      if (!value) return;
      /* the explicit rule path rides along so the normalizer routes the value
       * to its exact entity slot (worker validates it against MAP_PATHS) */
      const mapped = /^(?:crm:[a-z]+|[a-z][a-zA-Z0-9]{0,30})\.[a-z][a-zA-Z0-9_]{0,99}$/.test(path) ? path : undefined;
      out.push({ label: t.label, value, section: "", group: "", source: "taught", mapped });
    });
    return out;
  }

  /* invoked per frame by the worker via chrome.scripting.executeScript func -
   * fields from every frame are aggregated worker-side */
  /* shared with the mapping editor's peek, so the highlighted rows are
   * exactly the rows a capture would pull */
  globalThis.__bettersExpandTaughtRows = expandTaughtRows;
  /* labelled-field keys for the filler's peek and the editor's scan */
  globalThis.__bettersFieldsByLabel = (page, key, family) =>
    (page && labelKey(pageTitle()) !== page ? [] : fieldsByLabel(key, Boolean(family)));
  globalThis.__bettersFieldLabelText = fieldLabelText;
  /* the label of the labelled form-field box an element sits in ("" when
   * it isn't in one) - click-to-map turns that into a label mapping */
  globalThis.__bettersFormFieldLabel = (el) => {
    const box = el && el.closest ? el.closest(FORM_FIELD) : null;
    if (!box) return "";
    const lab = box.querySelector("label, mat-label, .k-label, legend");
    const t = lab ? stripMarks(text(lab)) : "";
    return t && t.length <= 80 ? t : "";
  };
  globalThis.__bettersCaptureElements = captureElements;
  /* `controls`: the page's saved control mappings. `secure` comes back
   * separately and is never merged into the capture by the worker. */
  globalThis.__bettersPortalIngest = (taught, controls) => {
    const secure = [];
    const fields = taughtFields(taught, secure)
      .concat(collect(controls, secure).filter((f) => !identifierField(f)))
      /* identifier data never becomes a timeline note, by label OR by what
       * the text itself says ("SSN 123...", "Passport ...") */
      .filter((f) => !(f.mapped && /^note/.test(f.mapped) && (identifierField(f) || sensitiveLabel(f.value))));
    /* a value mapped to Prior Coverage belongs to the line the page is
     * headed by: "Prior Auto Policy" and "Prior Home Policy" stay apart */
    const line = lineOfPage();
    if (line) fields.forEach((f) => { if (f.mapped && /^crm:priorcoverage\./.test(f.mapped)) f.section = "Prior " + line + " Policy"; });
    return { fields, secure, title: document.title, url: location.href };
  };
})();
