const CONFIG = {
  file: "conversation.md",
  accession: "ACCESSION 2226-0417",
  imageDir: "images/",
  patch: 16,
  highlights: ["She is presented here not as a person, but as a system:", "differs from typical transient records found in the period of production by its explicit compilation", "anchors for a narrative arc of personal growth during the maker's formation period.", "documents the maintenance of mental equilibrium"],
  labels: { 1: "Home page", 2: "NYCB Playbill and Ticket", 3: "MoMA ticket", 4: "Griffith Observatory ticket", 5: "Natural History brochure and tickets", 6: "The Met brochure", 7: "Lincoln Center ticket", 8: "Final accession statement" },
  autoHighlight: false,   // true = also highlight one automatically chosen phrase per bubble
  voice: { lang: "en", prefer: ["Samantha", "Daniel", "Google UK English Female", "Microsoft Aria", "Microsoft Jenny"], rate: 0.95, pitch: 1 },
  skipAloud: ["WORKING FILE", "REVISIONS"],   // sections that are not read aloud
  headings: ["ACCESSION NOTE", "OBSERVATIONS", "INTERPRETATIONS", "OPEN QUESTIONS", "ITEM NOTES", "FROM 2226", "COMPARISON", "REVISIONS", "WORKING FILE", "NEW QUESTIONS"]
};
// How speakers are marked in your exported markdown. Matches lines like "### User", "**Assistant:**", "User: text".
const ROLE_WORDS = { user: /^(user|you|human|operator)$/i, assistant: /^(assistant|ai|model|archivist.*)$/i, system: /^system$/i };

const roleOf = (w) => Object.keys(ROLE_WORDS).find((k) => ROLE_WORDS[k].test(w.trim()));
const HEAD = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*([A-Za-z][\w -]{0,30}?)\s*(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$/;
const INLINE = /^\s*(?:\*\*|__)([A-Za-z][\w -]{0,30}?)\s*:?\s*(?:\*\*|__)\s*:?\s*(.+)$|^\s*(user|you|human|operator|assistant|system)\s*:\s+(.+)$/i;

function parse(mdText) {
  const turns = []; let cur = null;
  for (const line of mdText.replace(/\r/g, "").split("\n")) {
    let role, rest = "", m = line.match(HEAD);
    if (m) role = roleOf(m[1]);
    if (!role && (m = line.match(INLINE))) { role = roleOf(m[1] || m[3]); rest = m[2] || m[4] || ""; if (!role) rest = ""; }
    if (role) { cur = { role, text: rest ? rest + "\n" : "" }; turns.push(cur); } else if (cur) cur.text += line + "\n";
  }
  turns.forEach((t) => (t.text = t.text.replace(/^\s*(---+|\*\*\*+)\s*$/gm, "").trim()));
  return turns;
}

function headingOf(line) {
  const s = line.replace(/^[\s#>*_-]+/, "");
  for (const h of CONFIG.headings) {
    if (s.startsWith(h) && !/^[A-Za-z]/.test(s.slice(h.length)))
      return { h, rest: s.slice(h.length).replace(/^[*_\s]*(\([^)]*\))?[*_\s]*:?[*_\s]*/, "") };
  }
}
function sections(text) {
  const out = []; let cur = null;
  for (const line of text.split("\n")) {
    const hd = headingOf(line);
    if (hd) { cur = { h: hd.h, body: hd.rest ? hd.rest + "\n" : "" }; out.push(cur); }
    else { if (!cur) { cur = { h: "REPLY", body: "" }; out.push(cur); } cur.body += line + "\n"; }
  }
  return out.map((s) => ({ ...s, body: s.body.trim() })).filter((s) => s.body || s.h !== "REPLY");
}
const THINK = /(?:&lt;|<)\|channel(?:&gt;|>)thought([\s\S]*?)(?:&lt;|<)channel\|(?:&gt;|>)/;
function buildSteps(turns) {
  const steps = []; let system = "";
  const blank = () => ({ op: "", imgs: [], secs: [], think: "" });
  for (const t of turns) {
    if (t.role === "system") system = t.text;
    else if (t.role === "user") {
      const st = blank();
      st.op = t.text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => (st.imgs.push(CONFIG.imageDir + alt.trim()), "")).trim();
      steps.push(st);
    } else {
      if (!steps.length) steps.push(blank());
      const st = steps[steps.length - 1], m = t.text.match(THINK);
      st.think = m ? m[1].trim() : "";
      st.secs = sections(t.text.replace(THINK, "").replace(/^\s*\(?\s*Word Count[^\n]*$/gim, "").trim());
    }
  }
  steps.forEach((s, i) => {
    s.checkpoint = /^\s*CHECKPOINT\s*$/i.test(s.op);
    const first = s.op.split("\n").find((l) => l.trim()) || "";
    s.label = CONFIG.labels[i + 1] || (s.checkpoint ? "Checkpoint" : first.replace(/^[#*\s]+|[*\s]+$/g, "").slice(0, 70) || `Step ${i + 1}`);
  });
  return { steps, system };
}

/* ============================ TERMINAL ============================ */
const $ = (id) => document.getElementById(id);
const out = $("term");
const EXTS = ["jpg", "jpeg", "png", "webp"];
const SHOW_THINK = new URLSearchParams(location.search).has("reasoning");   // add reasoning to the address to show its private reasoning
let paused = false, skip = false, speed = 1, prevFile = null;
const cur = Object.assign(document.createElement("span"), { className: "cur", textContent: "▌" });
const scroll = () => { out.scrollTop = out.scrollHeight; };
const gate = async () => { while (paused) await new Promise((r) => setTimeout(r, 120)); };
const sleep = async (ms) => { await gate(); if (!skip) await new Promise((r) => setTimeout(r, ms / speed)); };
function ln(cls, text = "") { const d = document.createElement("div"); d.className = "ln " + cls; d.textContent = text; out.appendChild(d); scroll(); return d; }

// Print text a few words at a time, like generation. Anything from transcript is printed verbatim.
function segments(text) { // split the text around any phrases that should be highlighted
  const hits = CONFIG.highlights.map((p) => [text.indexOf(p), p]).filter((h) => h[0] >= 0).sort((x, y) => x[0] - y[0]);
  const segs = []; let pos = 0;
  for (const [i, p] of hits) { if (i < pos) continue; if (i > pos) segs.push({ t: text.slice(pos, i) }); segs.push({ t: p, m: true }); pos = i + p.length; }
  if (pos < text.length) segs.push({ t: text.slice(pos) });
  return segs;
}
async function type(el, text, ms = 32) {
  el.appendChild(cur);
  const items = segments(text).flatMap((sg) => (sg.t.match(/\s*\S+\s*|\s+/g) || []).map((tok, n) => ({ tok, m: sg.m, first: n === 0 })));
  let mk = null;
  for (const it of items) {
    await gate();
    if (it.m) { if (it.first) { mk = document.createElement("mark"); el.insertBefore(mk, cur); } mk.appendChild(document.createTextNode(it.tok)); }
    else el.insertBefore(document.createTextNode(it.tok), cur);
    if (!skip) { scroll(); await sleep(ms); }
  }
  scroll();
}
const idOf = (l) => ((l.match(/^([HQ]\d+):/i) || [])[1] || "").toUpperCase();
function diffFile(lines, prev) { // how this working file differs from the previous one
  if (!prev) return lines.map((l) => ({ k: "same", l }));
  const ops = [], pm = new Map(), seen = new Set();
  prev.forEach((l) => { if (idOf(l)) pm.set(idOf(l), l); });
  for (const l of lines) {
    const id = idOf(l);
    if (!id) { ops.push({ k: prev.includes(l) ? "same" : "add", l }); continue; }
    seen.add(id);
    const o = pm.get(id);
    if (o === undefined) ops.push({ k: "add", l });
    else if (o !== l) ops.push({ k: "chg", l, o });
    else ops.push({ k: "same", l });
  }
  prev.forEach((l) => { if (idOf(l) && !seen.has(idOf(l))) ops.push({ k: "del", l }); });
  return ops;
}

function wordDiff(a, b) { // which words of the new line are new compared with the old line
  const x = a.split(/\s+/), y = b.split(/\s+/), L = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const res = []; let i = 0, j = 0;
  while (j < y.length) {
    if (i < x.length && x[i] === y[j]) { res.push({ w: y[j], c: false }); i++; j++; }
    else if (i < x.length && L[i + 1][j] >= L[i][j + 1]) i++;
    else { res.push({ w: y[j], c: true }); j++; }
  }
  return res;
}
const loadImg = (u) => new Promise((ok, no) => {
  const base = u.replace(/\.\w+$/, ""), list = [u, ...EXTS.map((e) => base + "." + e)];
  (function t(i) { if (i >= list.length) return no(); const im = new Image(); im.onload = () => ok(im); im.onerror = () => t(i + 1); im.src = list[i]; })(0);
});
async function patches(u) { // an image arrives as coarse blocks of colour, then resolves patch by patch
  const fig = document.createElement("figure"); fig.className = "pat";
  const cv = document.createElement("canvas"), cap = Object.assign(document.createElement("figcaption"), { className: "m", textContent: u });
  fig.append(cv, cap); out.appendChild(fig);
  let im; try { im = await loadImg(u); } catch (e) { cap.textContent = u + " (not found)"; return; }
  const P = CONFIG.patch, W = Math.min(im.naturalWidth, 340), H = Math.round((W * im.naturalHeight) / im.naturalWidth), k = im.naturalWidth / W;
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), s = document.createElement("canvas");
  s.width = Math.ceil(W / P); s.height = Math.ceil(H / P); s.getContext("2d").drawImage(im, 0, 0, s.width, s.height);
  g.imageSmoothingEnabled = false; g.drawImage(s, 0, 0, s.width * P, s.height * P); scroll();
  const cells = [];
  for (let y = 0; y < H; y += P) for (let x = 0; x < W; x += P) cells.push([x, y]);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  g.imageSmoothingEnabled = true;
  for (let i = 0; i < cells.length;) {
    await gate();
    const n = skip ? cells.length : Math.ceil(cells.length / 45);
    for (let b = 0; b < n && i < cells.length; b++, i++) { const [x, y] = cells[i]; g.drawImage(im, x * k, y * k, P * k, P * k, x, y, P, P); }
    await new Promise((r) => requestAnimationFrame(r));
  }
}

async function workingFile(body) {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const o of diffFile(lines, prevFile)) {
    if (o.k === "chg") { // same hypothesis as before: only the words that changed are marked
      const d = ln("t chg"); d.dataset.g = "~"; d.appendChild(cur);
      for (const t of wordDiff(o.o, o.l)) {
        const sp = Object.assign(document.createElement(t.c ? "mark" : "span"), { textContent: t.w + " " });
        d.insertBefore(sp, cur); scroll(); await sleep(22);
      }
      await sleep(170); continue;
    }
    const d = ln("t" + (o.k === "same" ? "" : " " + o.k));
    d.dataset.g = o.k === "add" ? "+" : o.k === "del" ? "−" : " ";
    await type(d, o.l, o.k === "del" ? 4 : 10); await sleep(o.k === "del" ? 80 : 170);
  }
  prevFile = lines;
}
async function section(h, body) {
  if (h) { ln("t hd", h); await sleep(140); }
  if (h === "WORKING FILE") await workingFile(body);
  else await type(ln("t body"), body, 34);
  await sleep(450);
}
async function runStep(i) {
  const s = steps[i]; skip = false;
  ln("m rule", `── ${i + 1}/${steps.length} ── ${s.label}`); await sleep(400);
  ln("m", "ingest ▸");
  await type(ln("t in"), s.op, 5);
  for (const u of s.imgs) await patches(u);
  await sleep(500);
  if (SHOW_THINK && s.think) await type(ln("t think"), s.think, 4);
  const paras = s.secs.length === 1 && s.secs[0].h === "REPLY";
  for (const x of paras ? s.secs[0].body.split(/\n\s*\n/).map((b) => ({ h: "", body: b.trim() })) : s.secs) await section(x.h === "REPLY" ? "" : x.h, x.body);
  await sleep(1600); // its last questions go unanswered for a moment
}
async function main() {
  $("title").textContent = `archivist-7 · ${CONFIG.accession.toLowerCase()}`;
  let system = "";
  try {
    ({ steps, system } = buildSteps(parse(await (await fetch(CONFIG.file)).text())));
    if (!steps.length) throw new Error();
  } catch (e) {
    return void (await type(ln("m"), `Couldn’t read ${CONFIG.file}. Keep it next to index.html and open the site through a web server (for example: python3 -m http.server). If the file loads but nothing appears, the speaker markers in your export may need a change to ROLE_WORDS in app.js.`, 8));
  }
  await type(ln("m"), `ARCHIVIST-7 ▸ mounting ${CONFIG.accession}`, 40); await sleep(300);
  if (system) { await type(ln("m"), `role ▸ ${system.length} characters`, 30); await sleep(200); }
  for (const u of [...new Set(steps.flatMap((s) => s.imgs))]) { await type(ln("m"), u, 5); await sleep(70); }
  await sleep(600);
  for (let i = 0; i < steps.length; i++) await runStep(i);
  const id = (CONFIG.accession.match(/\d{4}-\d{4}/) || ["accession"])[0];
  skip = false; await sleep(500);
  await type(ln("m rule"), `write ${id}.statement`, 30); await sleep(400);
  await type(ln("m"), "exit 0", 60);
}
let steps = [];
document.addEventListener("keydown", (e) => {
  if (e.key === " ") { e.preventDefault(); paused = !paused; document.body.classList.toggle("paused", paused); }
  if (e.key === "ArrowRight") skip = true;
  if (e.key === "r") location.reload();
  if (e.key === "+" || e.key === "=") speed = Math.min(6, speed * 1.5);
  if (e.key === "-") speed = Math.max(.3, speed / 1.5);
});
out.addEventListener("click", () => { paused = !paused; document.body.classList.toggle("paused", paused); });
main();
