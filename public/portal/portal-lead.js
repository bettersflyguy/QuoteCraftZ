/* One Lead: a live DOM boundary, never a stored nth-row selector. Closing,
 * replacing, navigating or changing the lead invalidates it. No page writes
 * other than a removable highlight overlay. */
(function () {
  "use strict";
  if (globalThis.__bettersLead) return;
  let selected = null, picking = null;
  const clean = v => String(v || "").replace(/\s+/g, " ").trim();
  const text = el => clean(el.innerText || el.textContent);
  const fingerprint = el => text(el) + "|" + [...el.querySelectorAll("input,select,textarea")]
    .filter(input => /name|email|phone|birth|dob/i.test(input.name + " " + input.id + " " + input.getAttribute("aria-label")))
    .map(input => input.value).join("|");
  function receipt(el) {
    if (/\bcall time\b/i.test(text(el)) && /\bcaller\s+(?:name|number|#)/i.test(text(el))) {
      throw new Error("Select the expanded lead details, not the dashboard table.");
    }
    const hits = [...text(el).matchAll(/receipt\s*(?:code|id|#)\s*:?\s*([a-z0-9-]{4,80})/ig)];
    if (hits.length > 1) throw new Error("Select only one expanded lead, not the lead list.");
    return hits[0]?.[1] || "";
  }
  function visible(el) {
    if (!el?.isConnected) return false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (n.hidden || n.getAttribute("aria-hidden") === "true" || s.display === "none" || s.visibility === "hidden") return false;
    }
    return true;
  }
  function highlight(el,preview=false) {
    const box=document.createElement("div");
    box.setAttribute("data-quotecraftz-lead-highlight",preview?"preview":"selected");
    box.style.cssText=`position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;border:3px ${preview?"dashed":"solid"} #ff00cc;background:rgba(255,0,204,.08)`;
    document.documentElement.appendChild(box);
    const update=()=>{
      if(!visible(el)){box.style.display="none";return;}
      const rects=[el,...el.querySelectorAll("*")].filter(n=>visible(n)).flatMap(n=>[...n.getClientRects()]).filter(r=>r.width>0&&r.height>0);
      if(!rects.length){box.style.display="none";return;}
      const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top));
      const right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom));
      Object.assign(box.style,{display:"block",left:`${left}px`,top:`${top}px`,width:`${right-left}px`,height:`${bottom-top}px`});
    };
    window.addEventListener("scroll",update,true);window.addEventListener("resize",update);
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(update):null;observer?.observe(el);
    update();
    return ()=>{box.remove();observer?.disconnect();window.removeEventListener("scroll",update,true);window.removeEventListener("resize",update);};
  }
  function clear() {
    selected?.unhighlight?.();
    selected = null;
  }
  function get() {
    if (!selected || selected.url !== location.href || !visible(selected.el) ||
        (selected.receipt ? receipt(selected.el) !== selected.receipt : fingerprint(selected.el) !== selected.fingerprint)) {
      throw new Error("1 Lead paused: select the expanded lead again. Its section closed, changed or is no longer on this page.");
    }
    return selected;
  }
  function pick(timeoutMs = 20000) {
    if (picking) picking(null);
    return new Promise(resolve => {
      let candidate = null, unhighlight = null, timer;
      const hint = document.createElement("div");
      hint.textContent = "1 Lead: click the highlighted lead area to ingest it. ↑ expands the area; Esc cancels.";
      hint.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;background:#073a89;color:white;padding:10px;font:14px Segoe UI;pointer-events:none";
      document.documentElement.appendChild(hint);
      function paint(el) {
        unhighlight?.();unhighlight=null;
        candidate = el;
        if(el)unhighlight=highlight(el,true);
      }
      function finish(result) {
        paint(null);hint.remove();clearTimeout(timer);
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("click", click, true);
        document.removeEventListener("keydown", key, true);
        picking = null;resolve(result);
      }
      function allowed(el) { return el && !el.matches("html,body,main,table,thead,tbody") && text(el).length >= 15; }
      function move(event) {
        let el = event.target instanceof Element ? event.target : null;
        let best=null;
        for (; el && !el.matches("html,body,main,table,thead,tbody"); el = el.parentElement) {
          if (!allowed(el)) continue;
          try {
            if ((receipt(el) && text(el).length >= 80) || (el.matches("section,fieldset,[role='region'],td[colspan],.card,.panel") && el.querySelectorAll("input,dt,tr,label").length >= 2)) best=el;
          } catch { break; }
        }
        if(best!==candidate)paint(best);
      }

      function click(event) {
        event.preventDefault();event.stopImmediatePropagation();
        if (!candidate) { hint.textContent = "Point inside the expanded details of ONE lead, then click."; return; }
        try {
          const el = candidate, code = receipt(el), stamp = fingerprint(el);
          paint(null);clear();
          selected = { el, receipt:code, fingerprint:stamp, url:location.href, unhighlight:highlight(el),
            key:location.origin + ":" + (code || crypto.randomUUID()) };
          globalThis.__bettersOneLead = true;
          finish({ label:code ? "Lead " + code : "Selected lead section", key:selected.key });
        } catch (error) { hint.textContent = error.message; }
      }
      function key(event) {
        if (event.key === "Escape") {event.preventDefault();finish(null);}
        else if (event.key === "ArrowUp" && allowed(candidate?.parentElement)) {event.preventDefault();paint(candidate.parentElement);}
      }
      picking = finish;
      document.addEventListener("pointermove", move, true);
      document.addEventListener("click", click, true);
      document.addEventListener("keydown", key, true);
      timer = setTimeout(() => finish("timeout"), timeoutMs);
    });
  }
  globalThis.__bettersLead = { get, pick, clear, cancel:() => picking?.(null) };
})();
