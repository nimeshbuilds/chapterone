'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { dialog, shell } = require('electron');

/** Real renderer/preload/cache/export flow with an entirely synthetic narrator. */
module.exports = async function checkAudioExportUi(win, root, temp) {
  const { Store } = require(path.join(root, 'src/main/store'));
  const elevenlabs = require(path.join(root, 'src/main/book/elevenlabs'));
  const store = new Store(temp);
  const id = 'audio-export-ui-fixture';
  const voiceId = 'offline-smoke-voice';
  const syntheticAudio = Buffer.from('ID3 Synthetic offline narration fixture');
  const originals = { listVoices: elevenlabs.listVoices, tts: elevenlabs.tts,
    saveDialog: dialog.showSaveDialog, openPath: shell.openPath };
  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = () => new Promise(resolve => setTimeout(resolve, 40));
  const wait = async (condition, description) => {
    for (let n = 0; n < 150; n++) {
      if (await condition()) return;
      await pause();
    }
    throw new Error(`Audio UI did not reach expected state: ${description}`);
  };
  const waitFor = (source) => wait(() => js(source), source);
  const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const clickText = async (text) => {
    const source = `[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    await waitFor(`!!(${source})`);
    await js(`(${source}).click()`);
  };
  const reload = async () => {
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await waitFor('!!document.querySelector(".library-view")');
  };
  const savedSettings = await js('window.api.getSettings()');
  let synthesisCalls = 0;
  let saveCalls = 0;
  const opened = [];
  elevenlabs.listVoices = async () => [{ voice_id: voiceId, name: 'Offline fixture narrator' }];
  elevenlabs.tts = async ({ voiceId: actualVoice, text }) => {
    assert.equal(actualVoice, voiceId);
    assert.match(text, /The quiet river/);
    synthesisCalls++;
    return { buffer: syntheticAudio };
  };
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(temp, `audio-export-${++saveCalls}.mp3`) });
  shell.openPath = async (file) => { opened.push(file); return ''; };
  try {
    store.saveBook({ id, title: 'Audio export fixture', author: 'Test Author', status: 'complete',
      outline: [{ number: 1, title: 'Audio fixture chapter' }],
      chapters: [{ number: 1, title: 'Audio fixture chapter', content: '# Audio fixture chapter\n\n' + 'The quiet river carried the boat home. '.repeat(30), words: 210 }] });
    await js(`window.api.saveSettings({audio:{elevenApiKey:'offline-smoke-key',voiceId:${JSON.stringify(voiceId)}}})`);
    await reload();
    await waitFor('!!document.querySelector(".book-open")');
    await click('.book-open');
    await waitFor('!!document.querySelector(".epub-reader")');
    await click('[title="Contents"]');
    await js(`[...document.querySelectorAll('.toc-item')].find(b=>b.textContent.includes('Audio fixture chapter')).click()`);
    await waitFor(`document.querySelector('[title="Narration voice"]').value===${JSON.stringify(voiceId)}`);
    const status = await js(`window.api.audiobookStatus(${JSON.stringify(id)},${JSON.stringify(voiceId)})`);
    assert.equal(status.have, 0);

    await click('[title="Save this chapter as MP3"]');
    await waitFor('!!document.querySelector("dialog[open]")');
    const disclosure = await js('document.querySelector("dialog[open]").textContent');
    assert.match(disclosure, /ElevenLabs.*paid quota/);
    assert.match(disclosure, /Save dialog will not refund/);
    await clickText('Cancel');
    await waitFor('!document.querySelector("dialog[open]")');
    assert.equal(synthesisCalls, 0, 'cancelling consent must not synthesize narration');
    assert.equal(saveCalls, 0, 'cancelling consent must not open Save');
    assert.equal(opened.length, 0);

    await click('[title="Save this chapter as MP3"]');
    await clickText('Narrate & export');
    await wait(() => opened.length === 1, 'first saved MP3');
    assert.equal(synthesisCalls, 1);
    assert.equal(saveCalls, 1);
    assert.deepEqual(fs.readFileSync(opened[0]), syntheticAudio);
    assert.equal((await js(`window.api.audiobookStatus(${JSON.stringify(id)},${JSON.stringify(voiceId)})`)).have, 1);

    await click('[title="Save this chapter as MP3"]');
    await wait(() => opened.length === 2, 'cached MP3 export');
    assert.equal(await js('document.querySelectorAll("dialog[open]").length'), 0);
    assert.equal(synthesisCalls, 1, 'exporting cached text/voice/model must not synthesize again');
    assert.equal(saveCalls, 2);
    assert.deepEqual(fs.readFileSync(opened[1]), syntheticAudio);
    console.log('  Audio UI passed: uncached MP3 disclosure/cancel makes no request, approved export synthesizes once, cached export reuses audio.');
  } finally {
    await js(`window.api.deleteBook(${JSON.stringify(id)})`).catch(() => {});
    await js(`window.api.saveSettings({audio:${JSON.stringify(savedSettings.audio)}})`).catch(() => {});
    await reload().catch(() => {});
    elevenlabs.listVoices = originals.listVoices;
    elevenlabs.tts = originals.tts;
    dialog.showSaveDialog = originals.saveDialog;
    shell.openPath = originals.openPath;
  }
};
