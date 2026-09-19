'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { nativeTheme } = require('electron');

// These checks drive the real sandboxed UI with an isolated library and the
// smoke runner's offline provider. They never use a real account or send mail.
module.exports = async function checkUi(win, bookId, enableProvider, seedLibrary, modelChecks) {
  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
  const application = process.argv.some(arg => arg.startsWith('--app-root=')) ? 'packaged' : 'source';
  const artifacts = path.join(__dirname, '..', 'artifacts', `ui-${process.platform}-${process.arch}-${application}`);
  fs.rmSync(artifacts, { recursive: true, force: true });
  fs.mkdirSync(artifacts, { recursive: true });
  const report = { platform: process.platform, arch: process.arch, application, checks: [], screenshots: [] };
  const waitFor = async (condition) => {
    for (let n = 0; n < 120; n++) {
      if (await js(condition)) return;
      await pause(50);
    }
    throw new Error(`UI did not reach expected state: ${condition}`);
  };
  const click = async (selector) => {
    await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await pause();
  };
  const clickText = async (label, scope = '#view-root') => {
    const query = `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    await waitFor(`!!(${query})`);
    await js(`(${query}).click()`);
    await pause();
  };
  const fill = async (selector, value) => {
    await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await pause();
  };
  const key = async (name) => {
    // Chromium input events exercise native focus traversal without depending
    // on which app owns OS focus on a headless CI desktop.
    const codes = { Enter: ['Enter', 'Enter', 13], Tab: ['Tab', 'Tab', 9], Escape: ['Escape', 'Escape', 27],
      Space: [' ', 'Space', 32], Down: ['ArrowDown', 'ArrowDown', 40] };
    const [key, code, windowsVirtualKeyCode] = codes[name];
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode,
      ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    await pause();
  };
  const screenshot = async (name) => {
    await pause(160);
    fs.writeFileSync(path.join(artifacts, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    report.screenshots.push({ name, viewport: await js('({width:innerWidth,height:innerHeight})') });
  };
  const check = async (name, run) => {
    await run();
    report.checks.push(name);
    console.log(`  UI passed: ${name}`);
  };
  const layoutFits = async () => {
    const overflow = await js(`(() => {
      const nodes = [document.documentElement, document.querySelector('.content'), document.querySelector('.reader-bar')].filter(Boolean);
      return nodes.filter(e => e.scrollWidth > e.clientWidth + 2).map(e => ({element:e.className || e.tagName, width:e.clientWidth, content:e.scrollWidth}));
    })()`);
    assert.deepEqual(overflow, [], 'Main controls must not overflow horizontally');
  };
  const nav = async (view) => {
    await click(`[data-view="${view}"]`);
    await waitFor(`document.querySelector('[data-view="${view}"]').getAttribute('aria-current') === 'page'`);
  };
  const openBook = async () => {
    await nav('library');
    await waitFor('!!document.querySelector(".book-open")');
    await click('.book-open');
    await waitFor('!!document.querySelector(".epub-reader")');
  };

  try {
    nativeTheme.themeSource = 'light';
    win.setContentSize(1180, 820);
    win.webContents.debugger.attach('1.3');
    await check('Current model presets, saved pins, retirement notices, and explicit quota checks', async () => {
      const initial = await js('window.api.getSettings()');
      const reload = async () => {
        await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
        await waitFor('!!document.querySelector(".nav-item[aria-current=page]")');
      };
      await js(`window.api.saveSettings({chain:['claude','codex','gemini','grok'], codexModel:'gpt-5.4-mini',
        images:{model:'saved-image-pin'}, audio:{model:'saved-audio-pin'}})`);
      await reload();
      await nav('settings');
      await pause(800);
      assert.equal(modelChecks.length, 0, 'Loading a legacy pin must not generate a model probe');
      assert.match(await js('document.querySelector("#eng-model-codex").closest(".model-pick").textContent'), /Retired.*August 31/);
      assert.equal(await js('document.querySelector("#s-img-model").value'), 'saved-image-pin');
      assert.equal(await js('document.querySelector("#s-aud-model").value'), 'saved-audio-pin');
      const custom = '#eng-model-codex + .model-custom .model-custom-input';
      await fill(custom, 'future-model-pin');
      await pause(800);
      assert.equal(modelChecks.length, 0, 'Typing must not consume provider quota');
      assert.equal(await js('window.api.getSettings().then(s => s.codexModel)'), 'future-model-pin');
      await screenshot('models-custom');
      await click('#eng-model-codex + .model-custom button');
      await waitFor('document.querySelector("#eng-model-codex + .model-custom .model-verify").textContent.includes("Offline model check")');
      assert.deepEqual(modelChecks, [{ provider: 'codex', model: 'future-model-pin' }]);
      await nav('create');
      await nav('settings');
      assert.equal(await js(`document.querySelector(${JSON.stringify(custom)}).value`), 'future-model-pin');
      assert.equal(modelChecks.length, 1, 'Navigating must not repeat the check');
      for (const [label, preset] of [['⚡ Fast', 'fast'], ['💎 Pro', 'pro'], ['Default', 'default']]) {
        await clickText(label);
        const saved = await js('window.api.getSettings()');
        const meta = await js('window.api.getModels()');
        for (const provider of saved.chain) assert.equal(saved[provider + 'Model'], meta.presets[provider][preset]);
      }
      assert.equal(modelChecks.length, 1, 'Preset selection must not generate a probe');
      await fill('#s-img-model', 'gemini-3.1-flash-lite-image');
      assert.match(await js('document.querySelector(".image-model-note").textContent'), /multiple character reference/);
      await fill('#s-img-model', 'gemini-2.5-flash-image');
      assert.match(await js('document.querySelector(".image-model-note").textContent'), /October 2, 2026/);
      win.setContentSize(900, 640);
      win.webContents.setZoomFactor(1.25);
      await fill('#eng-model-codex', '__custom__');
      await fill(custom, 'a-long-future-model-id-that-must-wrap-without-overflowing-the-layout');
      await layoutFits();
      await js('document.querySelector("#eng-model-codex").closest(".chain-step").scrollIntoView({block:"center"})');
      await screenshot('models-compact');
      win.webContents.setZoomFactor(1);
      win.setContentSize(1180, 820);
      await js(`window.api.saveSettings(${JSON.stringify(initial)})`);
      await reload();
    });
    await check('Library search, empty results, and list preference', async () => {
      await nav('library');
      await fill('.lib-search', 'no-such-book-xyz');
      assert.equal(await js('document.querySelectorAll("[data-book-search]:not([style*=none])").length'), 0);
      assert.equal(await js('document.querySelector(".search-empty").classList.contains("hidden")'), false);
      await screenshot('library-no-results');
      await clickText('Clear search');
      await fill('.lib-search', 'TEST AUTHOR');
      assert.equal(await js('getComputedStyle(document.querySelector(".book-card")).display !== "none"'), true);
      await click('[title="List"]');
      assert.equal(await js('document.querySelector("[title=List]").getAttribute("aria-pressed")'), 'true');
      await nav('settings');
      await nav('library');
      assert.equal(await js('!!document.querySelector(".book-row:not(.head)")'), true);
      await screenshot('library-list');
      await click('[title="Tiles"]');
      await fill('.lib-search', '');
      await screenshot('library');
    });

    await check('Adult and kids briefs survive navigation; missing provider blocks writing', async () => {
      await nav('create');
      assert.equal(await js('document.querySelector("#btn-skip").disabled'), true);
      await fill('#f-request', 'A river adventure with a very determined little boat.');
      await fill('#f-author', 'Test Author');
      await fill('#f-genre', 'Adventure');
      await clickText('+ Add character');
      await fill('.char-name', 'Mira');
      await fill('.char-role', 'The captain');
      await nav('settings');
      await nav('create');
      assert.equal(await js('document.querySelector("#f-genre").value'), 'Adventure');
      assert.equal(await js('document.querySelector(".char-name").value'), 'Mira');
      assert.equal(await js('document.querySelector(".writing-options").open'), false);
      await screenshot('create');
      await nav('kids');
      await fill('#k-request', 'A fox learns to share a garden.');
      await fill('#k-age', '3-5');
      await nav('library');
      await nav('kids');
      assert.equal(await js('document.querySelector("#k-age").value'), '3-5');
      assert.equal(await js('document.querySelector("#k-request").value'), 'A fox learns to share a garden.');
      await screenshot('kids');
    });

    await check('Minimum window and 125% zoom: forms, settings, tiles, list', async () => {
      win.setContentSize(900, 640);
      win.webContents.setZoomFactor(1.25);
      for (const view of ['create', 'kids', 'settings', 'library']) {
        await nav(view);
        await layoutFits();
        await screenshot(`${view}-compact`);
      }
      await click('[title="List"]');
      await layoutFits();
      await screenshot('library-list-compact');
      await click('[title="Tiles"]');
      win.webContents.setZoomFactor(1);
    });

    await check('Provider dialog, Escape, focus restoration, and keyboard switches', async () => {
      await nav('settings');
      await js(`([...document.querySelectorAll('button')].find(b => b.textContent.includes('Add API key'))).focus()`);
      await key('Enter');
      await waitFor('!!document.querySelector("dialog[open]")');
      assert.ok(await js('document.querySelector("dialog[open]").getAttribute("aria-labelledby")'));
      for (let n = 0; n < 5; n++) {
        await key('Tab');
        assert.equal(await js('!!document.activeElement.closest("dialog[open]")'), true);
      }
      await screenshot('provider-dialog');
      await key('Escape');
      assert.equal(await js('document.querySelectorAll("dialog[open]").length'), 0);
      assert.match(await js('document.activeElement.textContent'), /Add API key/);
      await js('document.querySelector("#t-research").focus()');
      const before = await js('document.querySelector("#t-research").checked');
      await key('Space');
      await waitFor(`document.querySelector('#t-research').checked === ${!before}`);
      assert.equal(await js('window.api.getSettings().then(s => s.research)'), !before);
      // Ensure the deterministic generation test never enables research/polish.
      for (const id of ['t-research', 't-polish']) {
        if (await js(`document.querySelector('#${id}').checked`)) await click(`#${id}`);
      }
      await fill('#s-claude-cmd', 'my-claude-command');
      await clickText('Re-check CLIs');
      assert.equal(await js('document.querySelector("#s-claude-cmd").value'), 'my-claude-command');
      await fill('#s-claude-cmd', 'claude');
    });

    await check('Keyboard book opening and reader controls at compact size', async () => {
      await nav('library');
      await js('document.querySelector(".book-open").focus()');
      await key('Enter');
      await waitFor('!!document.querySelector(".epub-reader")');
      assert.equal(await js('getComputedStyle(document.querySelector(".sidebar")).display'), 'none');
      assert.equal(await js('document.querySelector(".toc-drawer").inert'), true);
      assert.equal(await js('document.querySelector("#r-edit").disabled'), true);
      await click('[title="Contents"]');
      assert.equal(await js('document.querySelector("[title=Contents]").getAttribute("aria-expanded")'), 'true');
      assert.equal(await js('document.querySelector(".toc-drawer").inert'), false);
      await click('.toc-item[data-i="1"]');
      await waitFor('document.querySelector(".page-info").textContent.includes("Chapter 1")');
      await screenshot('reader-contents');
      await click('[title="Contents"]');
      await click('[title="Larger text"]');
      await fill('[title="Theme"]', 'night');
      await fill('[title="Typeface"]', 'sans');
      await fill('[title="Reading mode"]', 'scroll');
      await layoutFits();
      await fill('[title="Reading mode"]', 'chapter');
      await click('[title="Library"]');
      await openBook();
      assert.equal(await js('document.querySelector(".epub-reader").dataset.theme'), 'night');
      assert.equal(await js('document.querySelector(".epub-reader").dataset.font'), 'sans');
      await waitFor('document.querySelector(".page-info").textContent.includes("Chapter 1")');
      win.webContents.setZoomFactor(1.25);
      await layoutFits();
      await screenshot('reader-compact');
      win.webContents.setZoomFactor(1);
    });

    await check('Export menu keyboard navigation and Escape stay in reader', async () => {
      await click('[title="Export this book"]');
      assert.equal(await js('document.activeElement.className'), 'export-item');
      await key('Down');
      assert.match(await js('document.activeElement.textContent'), /PDF/);
      await key('Escape');
      assert.equal(await js('document.querySelector(".export-list").hidden'), true);
      assert.equal(await js('document.activeElement.title'), 'Export this book');
      assert.equal(await js('!!document.querySelector(".epub-reader")'), true);
    });

    await check('Stats, story bible, rename validation, and chapter edit persistence', async () => {
      await click('[title^="Book stats:"]');
      await waitFor('!!document.querySelector(".stats-modal")');
      assert.match(await js('document.querySelector(".stats-modal").textContent'), /Words.*282/);
      await key('Escape');
      await click('[title^="Story bible:"]');
      await waitFor('!!document.querySelector(".bible-modal")');
      assert.match(await js('document.querySelector(".bible-modal").textContent'), /A test book/);
      await key('Escape');
      await click('[title="Rename book / set author"]');
      await fill('dialog input', '');
      await clickText('Save', 'dialog');
      assert.equal(await js('document.querySelector("dialog input").getAttribute("aria-invalid")'), 'true');
      await fill('dialog input', 'The River and the Little Boat');
      await clickText('Save', 'dialog');
      await waitFor('!document.querySelector("dialog[open]")');
      await waitFor('document.querySelector(".reader-heading .title").textContent === "The River and the Little Boat"');
      await click('#r-edit');
      const edited = '# Opening\n\nMira steered the boat into the morning light. This sentence was edited by hand.';
      await fill('.edit-chapter-ta', edited);
      await screenshot('chapter-editor');
      await clickText('Save chapter', 'dialog');
      await waitFor('!document.querySelector("dialog[open]")');
      assert.equal(await js(`window.api.getBook(${JSON.stringify(bookId)}).then(b => b.chapters[0].content)`), `${edited}\n`);
      const exported = await js(`window.api.exportBook(${JSON.stringify(bookId)}, 'html', false)`);
      assert.match(fs.readFileSync(exported.path, 'utf8'), /This sentence was edited by hand/);
      await waitFor('document.querySelector(".reader-content").textContent.includes("edited by hand")');
      await fill('[title="Theme"]', 'sepia');
      await fill('[title="Typeface"]', 'serif');
      win.setContentSize(1180, 820);
      await screenshot('reader');
    });

    await check('Delete cancellation and repeated confirmation remain usable', async () => {
      await click('[title="Delete"]');
      await key('Escape');
      assert.ok(await js(`window.api.getBook(${JSON.stringify(bookId)}).then(b => b.id)`));
      await click('[title="Delete"]');
      await clickText('Cancel', 'dialog');
      assert.equal(await js('document.querySelectorAll("dialog[open]").length'), 0);
    });

    await check('Offline UI generation: clarification, editable outline, completion', async () => {
      enableProvider();
      await click('[title="Library"]');
      await nav('settings');
      await clickText('Re-check CLIs');
      await nav('create');
      await waitFor('!document.querySelector("#btn-clarify").disabled');
      await click('#btn-clarify');
      await waitFor('!!document.querySelector("#clar-0")');
      await click('.chip');
      assert.equal(await js('document.querySelector("#clar-0").value'), 'By the river');
      await clickText('✍️ Write the book');
      await waitFor('!!document.querySelector(".outline-review")');
      assert.equal(await js('document.querySelectorAll(".outline-review-row").length'), 2);
      await click('.outline-review-row:last-child [title="Cut this chapter"]');
      await fill('.or-title', 'The First Crossing');
      await screenshot('outline-review');
      await clickText('✅ Approve & start writing');
      await waitFor('!!document.querySelector(".reveal-overlay[open]")');
      await screenshot('book-complete');
      await clickText('📖 Read it now', 'dialog');
      await waitFor('!!document.querySelector(".epub-reader")');
      const books = await js('window.api.listBooks()');
      const created = books.find(b => b.id !== bookId);
      assert.equal(created.status, 'complete');
      assert.equal(created.chapters, 1);
      assert.equal(await js(`window.api.getBook(${JSON.stringify(created.id)}).then(b => b.outline[0].title)`), 'The First Crossing');
      await click('[title="Delete"]');
      await clickText('Delete book', 'dialog');
      await waitFor('!!document.querySelector(".library-view")');
      assert.equal((await js('window.api.listBooks()')).length, 1);
    });

    await check('Dark appearance, reduced motion, and populated library layout', async () => {
      seedLibrary();
      await nav('library');
      await waitFor('document.querySelectorAll(".book-card").length === 3');
      await screenshot('library-populated');
      nativeTheme.themeSource = 'dark';
      for (const view of ['library', 'create', 'kids', 'settings']) {
        await nav(view);
        await layoutFits();
        await screenshot(`${view}-dark`);
      }
      await openBook();
      await screenshot('reader-dark');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.equal(await js('getComputedStyle(document.querySelector(".toc-drawer")).transitionDuration'), '0s');
      await click('[title="Library"]');
    });

    await check('Clear-data typed confirmation, deletion, and fresh start', async () => {
      await nav('settings');
      await clickText('🗑  Clear all my data');
      assert.equal(await js('document.querySelector("dialog .btn-danger-solid").disabled'), true);
      await fill('dialog input', 'wrong phrase');
      assert.equal(await js('document.querySelector("dialog .btn-danger-solid").disabled'), true);
      await fill('dialog input', 'delete all my data');
      await screenshot('clear-data-confirmation');
      await click('dialog .btn-danger-solid');
      await waitFor('!!document.querySelector(".library-view .empty")');
      assert.deepEqual(await js('window.api.listBooks()'), []);
      await screenshot('empty-library');
      await nav('create');
      assert.equal(await js('document.querySelector("#f-request").value'), '');
      await nav('library');
    });
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error.message;
    await screenshot('failure').catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    nativeTheme.themeSource = 'system';
  }
};
