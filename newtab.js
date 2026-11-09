const COLUMN_MIN = 200;
const COLUMN_GAP = 12;
const MAX_COLUMNS = 6;
const FOLDER_CAP = 8;
const DOCK_SIZE = 8;

const HELP = [
  ['Find', [['type', 'filter, pinyin works'], ['esc', 'clear filter'], ['?', 'this list']]],
  ['Move', [['↑ ↓', 'previous / next link'], ['← →', 'next column'], ['tab', 'next / previous folder'], ['⌥1 … ⌥0', 'folder 1–10']]],
  ['Open', [['↵', 'open here'], ['⌘↵', 'background tab'], ['⇧↵', 'new window'], ['⌥↵', 'whole folder'], ['⌘⇧↵', 'search Google'], ['⌃1 … ⌃8', 'top site']]],
  ['Edit', [['⌘E', 'edit name & URL'], ['⌥↑ ⌥↓', 'reorder'], ['⌘C', 'copy URL'], ['⌘S', 'save pasted address'], ['⌘Z', 'undo']]],
  ['Everything else', [['⌘K', 'all other actions']]],
];

const pinyinByChar = new Map();
for (const entry of PINYIN_TABLE.split('|')) {
  const [syllable, chars] = entry.split(':');
  for (const char of chars) pinyinByChar.set(char, syllable);
}

// Chinese characters become syllables; other runs stay as words so mixed titles still match.
function pinyinOf(text) {
  if (!/[一-鿿]/.test(text)) return '';
  const parts = text.match(/[一-鿿]|[^\s一-鿿]+/g) || [];
  return parts.map(p => pinyinByChar.get(p) || p.toLowerCase()).join(' ');
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const favicon = url => `<img class="fav" src="${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32" alt="">`;
const host = u => { try { return new URL(/^[a-z]+:/i.test(u) ? u : 'https://' + u).host.replace(/^www\./, ''); } catch (e) { return u; } };
const urlLike = s => !/\s/.test(s) && (/^(https?|chrome|file):\/\/\S+/i.test(s) || /^localhost(:\d+)?(\/\S*)?$/i.test(s) || /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s));
const toUrl = s => /^[a-z]+:\/\//i.test(s) ? s : (/^localhost/i.test(s) ? 'http://' : 'https://') + s;

function matchText(text, py, s) {
  const t = text.toLowerCase(), i = t.indexOf(s);
  if (i === 0) return {s: 4, hl: [0, s.length]};
  if (i > 0) {
    const w = t.indexOf(' ' + s);
    return w >= 0 ? {s: 3, hl: [w + 1, w + 1 + s.length]} : {s: 2, hl: [i, i + s.length]};
  }
  if (py) {
    const sq = s.replace(/\s+/g, ''), full = py.replace(/\s+/g, ''), initials = py.split(/\s+/).map(w => w[0]).join('');
    if (initials.startsWith(sq) || full.startsWith(sq)) return {s: 2.5, py: true};
    if (full.includes(sq)) return {s: 1.5, py: true};
  }
  return null;
}
function matchLink(l, s) {
  return matchText(l.t, l.py, s) || (host(l.url).toLowerCase().includes(s) ? {s: 1, host: true} : null);
}
function highlight(t, m) {
  if (!m || !m.hl) return esc(t);
  const [a, b] = m.hl;
  return esc(t.slice(0, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>' + esc(t.slice(b));
}

function main() {
  const $ = s => document.querySelector(s);
  const app = $('.app'), input = $('.q'), colsEl = $('.cols'), scroller = $('.scroller'), topEl = $('.top');
  const cmdEl = $('.cmd'), cmdList = cmdEl.querySelector('ul'), countEl = $('.count'), hintsEl = $('.hints');
  const toastEl = $('.toast'), helpEl = $('.help'), dockEl = $('.dock');

  let folders = [], dock = [], rootId = '0', barId = null;
  let q = '', sel = null, lastFolder = null, cols = 5, mode = 'browse', editing = null, helpOpen = false;
  let cmdSel = 0, cmdCache = [], lastCards = [], colStops = [];
  let toastTimer = 0, loadTimer = 0, loadPending = false, queue = Promise.resolve();
  // keepEmpty holds folders made on this page, which stay visible until they get a link.
  const undo = [], aliases = new Map(), expanded = new Set(), keepEmpty = new Set();
  const collapsed = new Set(JSON.parse(localStorage.getItem('collapsed') || '[]'));

  const isCmd = () => q.startsWith('>');
  const query = () => isCmd() ? '' : q.trim().toLowerCase();
  const fById = id => folders.find(f => f.id === id);
  const folderOfLink = id => folders.find(f => f.links.some(l => l.id === id));
  const linkById = id => { for (const f of folders) for (const l of f.links) if (l.id === id) return l; return null; };
  const selLink = () => sel && sel.startsWith('l:') ? linkById(sel.slice(2)) : null;
  const selFolder = () => !sel ? null : sel.startsWith('l:') ? folderOfLink(sel.slice(2)) : fById(sel.slice(2));
  const currentFolder = () => fById(lastFolder) || folders[0];
  const node = k => colsEl.querySelector(`[data-stop="${k}"]`);
  const focusFilter = () => input.focus({preventScroll: true});
  // A deleted bookmark comes back from undo with a new id.
  const rid = id => { while (aliases.has(id)) id = aliases.get(id); return id; };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
  }

  // ----- bookmarks
  async function load() {
    const [tree] = await chrome.bookmarks.getTree();
    const nextFolders = [], bar = [];
    rootId = tree.id;
    const add = (n, parents, isBar) => {
      const links = n.children.filter(c => c.url), subs = n.children.filter(c => !c.url);
      const isRoot = parents === null;
      if (isBar) bar.push(...links);
      const shown = isBar ? links.slice(DOCK_SIZE) : links;
      if (shown.length || keepEmpty.has(n.id)) {
        const name = [...(parents || []), n.title].join(' / ');
        nextFolders.push({id: n.id, title: n.title, name, py: pinyinOf(name), parentId: n.parentId, isRoot,
          links: shown.map(l => ({id: l.id, t: l.title || host(l.url), url: l.url, index: l.index, parentId: l.parentId, py: pinyinOf(l.title)}))});
      }
      subs.forEach(s => add(s, isRoot ? [] : [...parents, n.title], false));
    };
    for (const r of tree.children) {
      const isBar = r.folderType ? r.folderType === 'bookmarks-bar' : r.id === '1';
      if (isBar && !barId) barId = r.id;
      add(r, null, isBar);
    }
    folders = nextFolders;
    // Loose links on the bookmarks bar keep ⌃1–⌃8 stable; most-visited is only a fallback.
    dock = bar.length ? bar.slice(0, DOCK_SIZE).map(l => ({title: l.title || host(l.url), url: l.url})) : (await chrome.topSites.get()).slice(0, DOCK_SIZE);
    dockEl.innerHTML = dock.map((d, i) => `<button type="button" class="site" data-site="${i}" title="${esc(d.title)}" aria-label="${esc(d.title)}" tabindex="-1">${favicon(d.url)}<b>${i + 1}</b></button>`).join('');
    render();
  }
  function scheduleLoad() {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => { if (mode === 'browse') load(); else loadPending = true; }, 60);
  }
  // Changes run one at a time so each sees the result of the last.
  function change(work) {
    queue = queue.then(async () => {
      try { await work(); } catch (e) { toast(`Chrome refused that: ${e.message}`); }
      await load();
    });
    return queue;
  }
  // chrome.bookmarks.move counts the destination index before removing the node.
  async function restorePosition(id, parentId, index) {
    const [n] = await chrome.bookmarks.get(rid(id));
    const target = n.parentId === parentId && index > n.index ? index + 1 : index;
    await chrome.bookmarks.move(n.id, {parentId, index: target});
  }

  // ----- rendering
  function compute() {
    const s = query(), cards = [];
    folders.forEach((f, idx) => {
      if (!s) {
        if (collapsed.has(f.id)) { cards.push({f, idx, rows: [], more: 0, collapsed: true}); return; }
        const cap = expanded.has(f.id) ? Infinity : FOLDER_CAP;
        cards.push({f, idx, rows: f.links.slice(0, cap).map(l => ({l, m: null})), more: Math.max(0, f.links.length - cap)});
        return;
      }
      const folderHit = !!matchText(f.name, f.py, s), rows = [];
      f.links.forEach(l => { const m = matchLink(l, s); if (m) rows.push({l, m}); else if (folderHit) rows.push({l, m: {s: .5}}); });
      if (rows.length) cards.push({f, idx, rows, more: 0});
    });
    return cards;
  }
  const firstStop = c => (c.collapsed || !c.rows.length) ? 'f:' + c.f.id : 'l:' + c.rows[0].l.id;

  function cardHTML(c, ci) {
    const f = c.f, s = query(), stops = colStops[ci];
    const headStop = c.collapsed || (!c.rows.length && !s);
    if (headStop) stops.push('f:' + f.id);
    const name = (mode === 'rename' && editing === f.id) ? `<input class="rename" value="${esc(f.title)}" aria-label="Folder name">` : `<span class="fname">${esc(f.name)}</span>`;
    let h = `<section class="card"><header class="head"${headStop ? ` data-stop="f:${f.id}"` : ''}>`
      + (c.idx < 10 ? `<span class="num">${(c.idx + 1) % 10}</span>` : '')
      + (c.collapsed ? '<span class="chev">▶</span>' : '') + name + `<span class="n">${f.links.length}</span></header>`;
    if (!c.collapsed) {
      if (!c.rows.length && !s) h += '<p class="empty-folder">Empty. Paste a link and press ⌘S.</p>';
      c.rows.forEach(({l, m}) => {
        const key = 'l:' + l.id;
        stops.push(key);
        if (mode === 'edit' && editing === l.id) {
          h += `<div class="edit" data-stop="${key}"><label><span>name</span><input class="edit-name" value="${esc(l.t)}" aria-label="Name"></label><label><span>url</span><input class="edit-url" value="${esc(l.url)}" aria-label="URL"></label></div>`;
          return;
        }
        const extra = m && m.py ? `<span class="py">${esc(l.py)}</span>` : m && m.host ? `<span class="py">${esc(host(l.url))}</span>` : '';
        h += `<div class="row" data-stop="${key}">${favicon(l.url)}<span class="t">${highlight(l.t, m)}</span>${extra}<kbd>↵</kbd></div>`;
      });
      if (c.more) { const key = 'm:' + f.id; stops.push(key); h += `<div class="more" data-stop="${key}">${c.more} more<kbd>↵</kbd></div>`; }
    }
    return h + '</section>';
  }

  function render(opts = {}) {
    const s = query(), cards = compute();
    lastCards = cards;
    // Masonry: each folder, in order, goes into the currently shortest column.
    const columnCount = s ? cols : Math.max(1, Math.min(cols, cards.length));
    const heights = Array(columnCount).fill(0), packed = Array.from({length: columnCount}, () => []);
    cards.forEach(c => {
      const h = 46 + (c.collapsed ? 0 : c.rows.length ? c.rows.length * 32 : 30) + (c.more ? 30 : 0);
      const k = heights.indexOf(Math.min(...heights));
      packed[k].push(c);
      heights[k] += h + COLUMN_GAP;
    });
    colStops = packed.map(() => []);
    if (!cards.length) {
      const t = esc(q.trim());
      colsEl.innerHTML = s ? `<p class="none">No bookmarks match “${t}”. ${urlLike(q.trim()) ? `↵ goes to ${t}, ⌘S saves it.` : '↵ searches Google.'}</p>` : '<p class="none">No bookmarks yet.</p>';
    } else {
      colsEl.innerHTML = packed.map((col, ci) => `<div class="col">${col.map(c => cardHTML(c, ci)).join('')}</div>`).join('');
    }
    const all = colStops.flat();
    if (opts.best && s) {
      let best = null, bs = -1;
      cards.forEach(c => c.rows.forEach(({l, m}) => { if (m.s > bs) { bs = m.s; best = 'l:' + l.id; } }));
      sel = best;
    }
    if (!all.includes(sel)) sel = all[0] || null;
    const n = cards.reduce((a, c) => a + c.rows.length, 0), total = folders.reduce((a, f) => a + f.links.length, 0);
    countEl.textContent = s ? `${n} match${n === 1 ? '' : 'es'}` : `${total} links · ${folders.length} folders`;
    app.classList.toggle('is-cmd', isCmd());
    renderCmd();
    paint();
  }

  function paint(reveal) {
    colsEl.querySelectorAll('.is-sel').forEach(x => x.classList.remove('is-sel'));
    colsEl.querySelectorAll('.is-cur').forEach(x => x.classList.remove('is-cur'));
    const n = sel && node(sel);
    if (n) {
      n.classList.add('is-sel');
      n.closest('.card').classList.add('is-cur');
      const f = selFolder();
      if (f) lastFolder = f.id;
      if (reveal) revealNode(n);
    }
    hints();
  }
  function revealNode(n) {
    const sr = scroller.getBoundingClientRect(), r = n.getBoundingClientRect();
    const y1 = r.top - sr.top, y2 = r.bottom - sr.top, top = topEl.offsetHeight + 8;
    if (y1 < top) scroller.scrollTop += y1 - top;
    else if (y2 > scroller.clientHeight - 8) scroller.scrollTop += y2 - scroller.clientHeight + 8;
  }
  function setSel(k) { if (!k) return; sel = k; paint(true); }

  function hints() {
    const s = q.trim(), l = selLink(), f = currentFolder();
    let h;
    if (mode === 'edit') h = [['tab', 'next field'], ['↵', 'save'], ['esc', 'cancel']];
    else if (mode === 'rename') h = [['↵', 'save'], ['esc', 'cancel']];
    else if (helpOpen) h = [['esc', 'close']];
    else if (isCmd()) h = [['↑↓', 'choose'], ['↵', 'run'], ['esc', 'back']];
    else if (query() && !colStops.flat().length) h = urlLike(s) && f ? [['↵', `go to ${s}`], ['⌘S', `save to ${f.name}`]] : [['↵', `search Google for “${s}”`]];
    else if (sel && sel.startsWith('m:')) h = [['↵', 'show all links'], ['↑↓', 'move']];
    else if (sel && sel.startsWith('f:')) h = [['↵', collapsed.has(sel.slice(2)) ? 'expand' : 'nothing to open'], ['⌘K', 'rename, collapse…']];
    else if (l && urlLike(s) && f) h = [['↵', `open ${l.t}`], ['⌘⇧↵', 'search Google'], ['⌘S', `save ${s} to ${f.name}`]];
    else if (l && query()) h = [['↵', `open ${l.t}`], ['⌘↵', 'background tab'], ['⌘⇧↵', 'search Google'], ['↑↓', 'next match'], ['esc', 'clear']];
    else h = [['↵', 'open'], ['⌘↵', 'background tab'], ['⌥↵', 'whole folder'], ['⌘E', 'edit'], ['⌘K', 'more'], ['?', 'all keys']];
    hintsEl.innerHTML = h.map(([k, t]) => `<span><kbd>${k}</kbd>${esc(t)}</span>`).join('');
  }

  // ----- movement
  function vmove(d) {
    const flat = colStops.flat();
    if (!flat.length) return;
    const i = flat.indexOf(sel);
    setSel(flat[i < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, i + d))]);
  }
  function hmove(d) {
    const ci = colStops.findIndex(c => c.includes(sel));
    if (ci < 0) return;
    let tj = ci + d;
    while (tj >= 0 && tj < colStops.length && !colStops[tj].length) tj += d;
    if (tj < 0 || tj >= colStops.length) return;
    const r0 = node(sel).getBoundingClientRect(), cy = (r0.top + r0.bottom) / 2;
    let best = null, bd = Infinity;
    colStops[tj].forEach(k => { const r = node(k).getBoundingClientRect(), dd = Math.abs((r.top + r.bottom) / 2 - cy); if (dd < bd) { bd = dd; best = k; } });
    setSel(best);
  }
  function fjump(d) {
    if (!lastCards.length) return;
    const f = selFolder(), i = lastCards.findIndex(c => c.f === f);
    setSel(firstStop(lastCards[(i + d + lastCards.length) % lastCards.length]));
  }
  function fnum(n) {
    const f = folders[n === 0 ? 9 : n - 1];
    if (!f) return;
    const c = lastCards.find(c => c.f === f);
    if (c) setSel(firstStop(c)); else toast(`${f.name} has no matches`);
  }

  // ----- opening
  async function openUrl(url, how) {
    if (/^javascript:/i.test(url)) throw new Error('bookmarklets can’t run from the new tab page');
    const tab = await chrome.tabs.getCurrent();
    if (how === 'window') await chrome.windows.create({url});
    else if (how === 'background') await chrome.tabs.create({url, active: false, openerTabId: tab.id});
    else await chrome.tabs.update(tab.id, {url});
  }
  const howOf = e => (e.metaKey || e.ctrlKey) ? 'background' : e.shiftKey ? 'window' : 'here';
  const whereText = {here: 'this tab', background: 'a background tab', window: 'a new window'};
  function openAndReport(url, name, how) {
    openUrl(url, how).then(() => { if (how !== 'here') toast(`Opened ${name} in ${whereText[how]}`); }, e => toast(`Couldn’t open ${name}: ${e.message}`));
  }
  function activate(e) {
    const s = q.trim(), how = howOf(e);
    const google = where => openAndReport('https://www.google.com/search?q=' + encodeURIComponent(s), `a search for “${s}”`, where);
    if (s && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) return google('here');
    if (query() && !colStops.flat().length) {
      if (urlLike(s)) openAndReport(toUrl(s), s, how); else google(how);
      return;
    }
    if (!sel) return;
    const id = sel.slice(2);
    if (sel.startsWith('m:')) {
      const f = fById(id);
      expanded.add(id);
      render();
      setSel('l:' + f.links[FOLDER_CAP].id);
      return;
    }
    if (sel.startsWith('f:')) {
      if (collapsed.has(id)) toggleCollapse(fById(id));
      return;
    }
    const l = linkById(id);
    if (e.altKey) openFolder(folderOfLink(id));
    else openAndReport(l.url, l.t, how);
  }
  async function openFolder(f) {
    try {
      for (const l of f.links) await openUrl(l.url, 'background');
      toast(`Opened ${f.links.length} links from ${f.name}`);
    } catch (e) { toast(`Couldn’t open every link: ${e.message}`); }
  }
  function openSite(i) {
    const site = dock[i], b = dockEl.children[i];
    if (!site) return;
    b.classList.add('is-hit');
    setTimeout(() => b.classList.remove('is-hit'), 450);
    openAndReport(site.url, site.title, 'here');
  }

  // ----- changing bookmarks
  function reorder(d) {
    change(async () => {
      const l = selLink();
      if (!l) return;
      const f = folderOfLink(l.id), i = f.links.indexOf(l), other = f.links[i + d];
      if (!other) return;
      if (i + d >= FOLDER_CAP) expanded.add(f.id);
      await chrome.bookmarks.move(l.id, {parentId: l.parentId, index: d < 0 ? other.index : other.index + 1});
      undo.push(() => restorePosition(l.id, l.parentId, l.index));
      toast(`Moved ${l.t} ${d < 0 ? 'up' : 'down'}`);
    }).then(() => paint(true));
  }
  function copyUrl() {
    const l = selLink();
    if (l) navigator.clipboard.writeText(l.url).then(() => toast(`Copied ${l.url}`), e => toast(`Couldn’t copy: ${e.message}`));
  }
  function startEdit() {
    const l = selLink();
    if (!l) return toast('Select a link first');
    mode = 'edit'; editing = l.id;
    render();
    const n = colsEl.querySelector('.edit-name');
    n.focus({preventScroll: true}); n.select();
  }
  function startRename(f) {
    mode = 'rename'; editing = f.id;
    render();
    const n = colsEl.querySelector('.rename');
    n.focus({preventScroll: true}); n.select();
  }
  function endMode() {
    mode = 'browse'; editing = null;
    render();
    focusFilter();
    if (loadPending) { loadPending = false; load(); }
  }
  function saveEdit() {
    const l = linkById(editing), title = colsEl.querySelector('.edit-name').value.trim(), url = colsEl.querySelector('.edit-url').value.trim();
    endMode();
    change(async () => {
      const id = rid(l.id);
      await chrome.bookmarks.update(id, {title: title || l.t, url: url ? toUrl(url) : l.url});
      undo.push(() => chrome.bookmarks.update(rid(id), {title: l.t, url: l.url}));
      toast(`Saved ${title || l.t}`);
    });
  }
  function saveRename() {
    const f = fById(editing), title = colsEl.querySelector('.rename').value.trim();
    endMode();
    if (!title || title === f.title) return;
    change(async () => {
      await chrome.bookmarks.update(f.id, {title});
      undo.push(() => chrome.bookmarks.update(f.id, {title: f.title}));
      toast(`Renamed folder to ${title}`);
    });
  }
  function saveUrl() {
    const s = q.trim(), f = currentFolder();
    if (!urlLike(s)) return toast('Paste or type an address first, then ⌘S');
    if (!f) return toast('Create a folder first');
    const url = toUrl(s);
    let created = null;
    q = ''; input.value = '';
    change(async () => {
      created = await chrome.bookmarks.create({parentId: f.id, title: host(url), url});
      undo.push(() => chrome.bookmarks.remove(rid(created.id)));
      collapsed.delete(f.id);
      expanded.add(f.id);
      sel = 'l:' + created.id;
    }).then(() => {
      if (!created) return;
      startEdit();
      toast(`Saved to ${f.name}. Name it, then ↵`);
    });
  }
  function moveTo(l, to) {
    change(async () => {
      await chrome.bookmarks.move(l.id, {parentId: to.id});
      undo.push(() => restorePosition(l.id, l.parentId, l.index));
      collapsed.delete(to.id);
      if (to.links.length >= FOLDER_CAP) expanded.add(to.id);
      saveCollapsed();
      toast(`Moved ${l.t} to ${to.name} · ⌘Z undoes`);
    }).then(() => setSel('l:' + l.id));
  }
  function del(l) {
    const flat = colStops.flat();
    sel = flat[flat.indexOf('l:' + l.id) + 1] || null;
    change(async () => {
      await chrome.bookmarks.remove(l.id);
      undo.push(async () => {
        const n = await chrome.bookmarks.create({parentId: rid(l.parentId), index: l.index, title: l.t, url: l.url});
        aliases.set(l.id, n.id);
        sel = 'l:' + n.id;
      });
      toast(`Deleted ${l.t} · ⌘Z undoes`);
    });
  }
  function newFolder() {
    const f = selFolder(), parentId = f && f.parentId !== rootId ? f.parentId : barId;
    let created = null;
    change(async () => {
      created = await chrome.bookmarks.create({parentId, title: 'New folder'});
      keepEmpty.add(created.id);
      undo.push(() => chrome.bookmarks.remove(created.id));
      sel = 'f:' + created.id;
    }).then(() => { if (created) startRename(fById(created.id)); });
  }
  function doUndo() {
    const fn = undo.pop();
    change(async () => { await fn(); toast('Undone'); });
  }
  function saveCollapsed() { localStorage.setItem('collapsed', JSON.stringify([...collapsed])); }
  function toggleCollapse(f) {
    if (collapsed.has(f.id)) collapsed.delete(f.id); else collapsed.add(f.id);
    saveCollapsed();
    render();
    setSel(collapsed.has(f.id) || !f.links.length ? 'f:' + f.id : 'l:' + f.links[0].id);
  }
  function setHelp(v) { helpOpen = v; helpEl.hidden = !v; hints(); }

  // ----- command menu (⌘K or a leading ">")
  function isDark() {
    const saved = document.documentElement.dataset.theme;
    return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }
  function commands() {
    const l = selLink(), f = selFolder(), list = [];
    if (l) list.push({label: `Open “${l.t}” in a new window`, keys: '⇧↵', run: () => openAndReport(l.url, l.t, 'window')});
    if (f && f.links.length) list.push({label: `Open all ${f.links.length} links in ${f.name}`, keys: '⌥↵', run: () => openFolder(f)});
    if (l) list.push({label: `Edit “${l.t}”`, keys: '⌘E', run: startEdit}, {label: `Copy link to “${l.t}”`, keys: '⌘C', run: copyUrl});
    if (l) folders.forEach(x => { if (x !== f) list.push({label: `Move “${l.t}” to ${x.name}`, run: () => moveTo(l, x)}); });
    if (l) list.push({label: `Delete “${l.t}”`, sub: '⌘Z undoes', danger: true, run: () => del(l)});
    if (f && !f.isRoot) list.push({label: `Rename folder ${f.name}`, run: () => startRename(f)});
    if (f) list.push({label: `${collapsed.has(f.id) ? 'Expand' : 'Collapse'} ${f.name}`, run: () => toggleCollapse(f)});
    list.push({label: 'Expand all folders', run: () => { collapsed.clear(); saveCollapsed(); render(); }});
    list.push({label: 'New folder', run: newFolder});
    list.push({label: `Switch to ${isDark() ? 'light' : 'dark'} theme`, run: () => setTheme(isDark() ? 'light' : 'dark')});
    [['History', 'history'], ['Downloads', 'downloads'], ['Bookmark manager', 'bookmarks'], ['Extensions', 'extensions'], ['Chrome settings', 'settings']]
      .forEach(([n, p]) => list.push({label: `Open ${n}`, sub: `chrome://${p}`, run: () => openAndReport(`chrome://${p}`, n, 'here')}));
    list.push({label: 'Show keyboard shortcuts', keys: '?', run: () => setHelp(true)});
    return list;
  }
  function renderCmd() {
    cmdEl.hidden = !isCmd();
    if (!isCmd()) return;
    const words = q.slice(1).trim().toLowerCase().split(/\s+/).filter(Boolean);
    cmdCache = commands().filter(c => words.every(w => (c.label + ' ' + (c.sub || '')).toLowerCase().includes(w)));
    cmdSel = Math.max(0, Math.min(cmdSel, cmdCache.length - 1));
    cmdList.innerHTML = cmdCache.length
      ? cmdCache.map((c, i) => `<li class="ci${i === cmdSel ? ' is-sel' : ''}${c.danger ? ' is-danger' : ''}" data-i="${i}"><span class="lbl">${esc(c.label)}</span>${c.sub ? `<span class="sub">${esc(c.sub)}</span>` : ''}${c.keys ? `<kbd>${c.keys}</kbd>` : ''}</li>`).join('')
      : '<li class="ci-none">No command matches</li>';
    const n = cmdList.children[cmdSel];
    if (n && cmdCache.length) {
      const t = n.offsetTop, b = t + n.offsetHeight;
      if (t < cmdEl.scrollTop) cmdEl.scrollTop = t;
      else if (b > cmdEl.scrollTop + cmdEl.clientHeight) cmdEl.scrollTop = b - cmdEl.clientHeight;
    }
  }
  function clearQuery() { q = ''; input.value = ''; render(); }
  function runCmd(i) {
    const c = cmdCache[i];
    if (!c) return;
    clearQuery();
    c.run();
  }

  // ----- keyboard
  input.addEventListener('input', () => { q = input.value; cmdSel = 0; render({best: true}); });
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key, letter = k.toLowerCase();
    if (helpOpen) {
      if (k === 'Escape' || k === '?') { e.preventDefault(); setHelp(false); return; }
      setHelp(false);
    }
    if (isCmd()) {
      if (k === 'ArrowDown') { e.preventDefault(); cmdSel = Math.min(cmdSel + 1, cmdCache.length - 1); renderCmd(); }
      else if (k === 'ArrowUp') { e.preventDefault(); cmdSel = Math.max(cmdSel - 1, 0); renderCmd(); }
      else if (k === 'Enter') { e.preventDefault(); runCmd(cmdSel); }
      else if (k === 'Escape' || (mod && letter === 'k')) { e.preventDefault(); clearQuery(); }
      else if (k === 'Tab') e.preventDefault();
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const d = k === 'ArrowDown' ? 1 : -1; if (e.altKey) reorder(d); else vmove(d); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); hmove(k === 'ArrowRight' ? 1 : -1); }
    else if (k === 'Tab') { e.preventDefault(); fjump(e.shiftKey ? -1 : 1); }
    else if (k === 'Enter') { e.preventDefault(); activate(e); }
    else if (k === 'Escape') { if (q) { e.preventDefault(); clearQuery(); } }
    else if (k === '?' && !q) { e.preventDefault(); setHelp(true); }
    else if (mod && letter === 'k') { e.preventDefault(); q = '>'; input.value = '>'; cmdSel = 0; render(); }
    else if (mod && letter === 'e') { e.preventDefault(); startEdit(); }
    else if (mod && letter === 's') { e.preventDefault(); saveUrl(); }
    else if (mod && letter === 'c' && input.selectionStart === input.selectionEnd && selLink()) { e.preventDefault(); copyUrl(); }
    else if (mod && letter === 'z' && !q && undo.length) { e.preventDefault(); doUndo(); }
    else if (e.altKey && !mod && /^Digit\d$/.test(e.code)) { e.preventDefault(); fnum(+e.code.slice(5)); }
    else if (e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-8]$/.test(e.code)) { e.preventDefault(); openSite(+e.code.slice(5) - 1); }
  });
  colsEl.addEventListener('keydown', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); endMode(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (mode === 'edit') saveEdit(); else saveRename(); }
    else if (e.key === 'Tab') { e.preventDefault(); if (mode === 'edit') colsEl.querySelector(t.classList.contains('edit-name') ? '.edit-url' : '.edit-name').focus({preventScroll: true}); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Alt') app.classList.add('show-nums');
    if (document.activeElement === document.body) focusFilter();
  });
  document.addEventListener('keyup', e => { if (e.key === 'Alt') app.classList.remove('show-nums'); });
  window.addEventListener('blur', () => app.classList.remove('show-nums'));

  // ----- mouse: same selection as the keyboard, focus stays in the filter
  app.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });
  app.addEventListener('mousemove', e => {
    if (mode !== 'browse' || isCmd()) return;
    const s = e.target.closest('[data-stop]');
    if (s && s.dataset.stop !== sel) { sel = s.dataset.stop; paint(); }
  });
  app.addEventListener('click', e => {
    if (helpOpen) { setHelp(false); focusFilter(); return; }
    if (mode !== 'browse') { if (!e.target.closest('.edit, .rename')) endMode(); return; }
    const ci = e.target.closest('.ci'), stop = e.target.closest('[data-stop]'), site = e.target.closest('.site');
    if (ci && ci.dataset.i) runCmd(+ci.dataset.i);
    else if (stop) { sel = stop.dataset.stop; paint(); activate(e); }
    else if (site) openSite(+site.dataset.site);
    if (mode === 'browse') focusFilter();
  });
  app.addEventListener('auxclick', e => {
    const stop = e.target.closest('.row');
    if (e.button === 1 && stop) { sel = stop.dataset.stop; paint(); activate({metaKey: true}); }
  });

  const columnsFor = w => Math.max(1, Math.min(MAX_COLUMNS, Math.floor((w + COLUMN_GAP) / (COLUMN_MIN + COLUMN_GAP))));
  cols = columnsFor(colsEl.clientWidth);
  new ResizeObserver(entries => {
    const w = entries[0].contentRect.width;
    if (!w || columnsFor(w) === cols) return;
    cols = columnsFor(w);
    // Rendering changes this element's size, which a ResizeObserver callback must not do.
    requestAnimationFrame(() => render());
  }).observe(colsEl);

  for (const ev of [chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onChildrenReordered]) ev.addListener(scheduleLoad);

  $('.help-grid').innerHTML = HELP.map(([group, rows]) => `<div><h4>${group}</h4>${rows.map(([k, t]) => `<div class="r"><span>${t}</span><kbd>${k}</kbd></div>`).join('')}</div>`).join('');

  load();
  focusFilter();
}

main();
