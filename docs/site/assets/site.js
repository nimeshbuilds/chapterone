'use strict';

(() => {
  const root = document.documentElement;
  const menu = document.querySelector('.menu-toggle');
  const theme = document.querySelector('.theme-toggle');
  const trigger = document.querySelector('.search-trigger');
  const dialog = document.querySelector('.search-dialog');
  const input = document.getElementById('search-input');
  const status = document.getElementById('search-status');
  const results = document.getElementById('search-results');
  let indexPromise;
  let querySequence = 0;
  let previouslyFocused;
  root.classList.add('js-ready');
  menu.hidden = false;
  theme.hidden = false;
  trigger.hidden = false;

  function setMenu(open) {
    root.dataset.navOpen = String(open);
    menu.setAttribute('aria-expanded', String(open));
  }
  setMenu(false);
  menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  document.querySelector('.site-nav').addEventListener('click', (event) => { if (event.target.closest('a')) setMenu(false); });

  function setTheme(value) {
    root.dataset.theme = value;
    theme.setAttribute('aria-label', `Switch to ${value === 'dark' ? 'light' : 'dark'} theme`);
  }
  let savedTheme;
  try { savedTheme = localStorage.getItem('chapterone-docs-theme'); } catch (_) { /* Private browser storage can be unavailable. */ }
  setTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  theme.addEventListener('click', () => {
    const value = root.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(value);
    try { localStorage.setItem('chapterone-docs-theme', value); } catch (_) { /* Reading does not require storage. */ }
  });

  function loadIndex() {
    if (!indexPromise) {
      // Resolve against the script itself so search also works on GitHub's nested 404 URLs.
      const script = [...document.scripts].find((element) => /\/assets\/site\.js(?:\?|$)/.test(element.src));
      const url = new URL('../search-index.json', script ? script.src : location.href);
      indexPromise = fetch(url).then((response) => {
        if (!response.ok) throw new Error('Search index could not be loaded.');
        return response.json();
      }).catch((error) => { indexPromise = null; throw error; });
    }
    return indexPromise;
  }
  function openSearch() {
    if (dialog.open) return;
    previouslyFocused = document.activeElement;
    dialog.showModal();
    input.focus();
    search();
  }
  trigger.addEventListener('click', openSearch);
  document.querySelector('.search-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { if (previouslyFocused?.isConnected) previouslyFocused.focus(); });
  document.addEventListener('keydown', (event) => {
    const editing = /^(?:INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
    if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (!editing && event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      event.preventDefault(); openSearch();
    } else if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      setMenu(false); menu.focus();
    }
  });
  function normalize(value) { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }
  async function search() {
    const sequence = ++querySequence;
    const query = input.value.trim().slice(0, 160);
    results.replaceChildren();
    if (!query) { status.textContent = 'Type a few words to search the handbook.'; return; }
    status.textContent = 'Searching…';
    try {
      const entries = await loadIndex();
      if (sequence !== querySequence) return;
      const terms = normalize(query).split(/\s+/).filter(Boolean);
      const matches = entries.map((entry) => {
        const title = normalize(entry.title);
        const description = normalize(entry.description);
        const body = normalize(entry.text);
        const joined = `${title} ${description} ${body}`;
        if (!terms.every((term) => joined.includes(term))) return null;
        const score = terms.reduce((n, term) => n + (title.includes(term) ? 8 : 0) + (description.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0), 0);
        return { ...entry, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12);
      status.textContent = matches.length ? `${matches.length} guide${matches.length === 1 ? '' : 's'} found. Use Tab to browse results.` : 'No matching guides. Try fewer words or a topic such as “audio”, “restore”, or “API key”.';
      for (const entry of matches) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        const script = [...document.scripts].find((element) => /\/assets\/site\.js(?:\?|$)/.test(element.src));
        link.href = new URL(`../${entry.url}`, script ? script.src : location.href).href;
        const section = document.createElement('small'); section.textContent = entry.section;
        const title = document.createElement('strong'); title.textContent = entry.title;
        const excerpt = document.createElement('span');
        const found = normalize(entry.text).indexOf(terms[0]);
        const start = Math.max(0, found - 55);
        excerpt.textContent = `${start ? '…' : ''}${entry.text.slice(start, start + 200)}${entry.text.length > start + 200 ? '…' : ''}`;
        link.append(section, title, excerpt); li.append(link); results.append(li);
      }
    } catch (_) {
      if (sequence === querySequence) status.textContent = 'Search is unavailable. Try again, or use the guide navigation. Local previews need an HTTP server.';
    }
  }
  input.addEventListener('input', search);
})();
