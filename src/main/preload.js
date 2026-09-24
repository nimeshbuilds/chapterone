'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Unwrap the {ok,data,error} envelope from IPC handlers into a promise.
 *  Variadic: forwards every argument so multi-arg handlers (e.g. model:verify
 *  with provider + model) receive them all — passing only the first silently
 *  dropped the rest. */
async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok) return res.data;
  throw new Error((res && res.error) || `IPC ${channel} failed`);
}

contextBridge.exposeInMainWorld('api', {
  // settings & meta
  getSettings: () => invoke('settings:get'),
  saveSettings: (partial) => invoke('settings:save', partial),
  clearAllData: () => invoke('data:clear'),
  getModels: () => invoke('meta:models'),

  // prerequisites
  checkPrerequisites: () => invoke('prereq:check'),
  checkAuth: (provider) => invoke('prereq:auth', provider),
  verifyModel: (provider, model) => invoke('model:verify', provider, model),
  getAuthStatus: () => invoke('prereq:authStatus'),

  // Nano Banana images
  verifyImageKey: () => invoke('images:verify'),
  estimateImages: (spec) => invoke('images:estimate', spec),

  // ElevenLabs audiobook
  listVoices: () => invoke('audio:voices'),
  verifyAudio: () => invoke('audio:verify'),
  synthChapter: (id, index, voiceId, force) => invoke('audio:synth', { id, index, voiceId, force }),
  exportAudio: (id, index, voiceId) => invoke('audio:export', { id, index, voiceId }),
  generateAudiobook: (id, voiceId) => invoke('audio:generate-all', { id, voiceId }),
  audiobookStatus: (id, voiceId) => invoke('audio:status', { id, voiceId }),
  exportAudiobook: (id, voiceId) => invoke('audio:full', { id, voiceId }),
  cloneVoice: (name, samples) => invoke('audio:clone', { name, samples }),
  onAudioProgress: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('audio:progress', listener);
    return () => ipcRenderer.removeListener('audio:progress', listener);
  },
  onFullAudioProgress: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('audio:full-progress', listener);
    return () => ipcRenderer.removeListener('audio:full-progress', listener);
  },

  // one-click CLI install
  installCli: (provider) => invoke('cli:install', provider),
  onInstallOutput: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('cli:install:output', listener);
    return () => ipcRenderer.removeListener('cli:install:output', listener);
  },

  // guided sign-in
  startAuth: (provider) => invoke('auth:start', provider),
  authInput: (sessionId, text) => invoke('auth:input', { sessionId, text }),
  cancelAuth: (sessionId) => invoke('auth:cancel', sessionId),
  onAuthEvents: (handlers) => {
    const map = {
      'auth:output': (_e, d) => handlers.onOutput && handlers.onOutput(d),
      'auth:url': (_e, d) => handlers.onUrl && handlers.onUrl(d),
      'auth:closed': (_e, d) => handlers.onClosed && handlers.onClosed(d),
    };
    for (const [ch, fn] of Object.entries(map)) ipcRenderer.on(ch, fn);
    return () => { for (const ch of Object.keys(map)) ipcRenderer.removeAllListeners(ch); };
  },

  // generation
  clarify: (spec) => invoke('book:clarify', spec),
  generate: (spec, answers, jobId) => invoke('book:generate', { spec, answers, jobId }),
  resumeBook: (id, jobId) => invoke('book:resume', { id, jobId }),
  cancelGeneration: (jobId) => invoke('book:cancel', jobId),
  approveOutline: (jobId, outline) => invoke('outline:approve', { jobId, outline }),

  // author tools
  updateChapter: (id, index, content) => invoke('book:updateChapter', { id, index, content }),
  rewriteChapter: (id, index, note, jobId) => invoke('book:rewriteChapter', { id, index, note, jobId }),
  updateBook: (id, fields) => invoke('book:update', { id, ...fields }),
  bookStats: (id) => invoke('book:stats', id),
  bookReadiness: (id) => invoke('book:readiness', id),
  getChapterRevisions: (id, index) => invoke('book:revisions', { id, index }),
  getChapterRevision: (id, index, revisionId) => invoke('book:revision', { id, index, revisionId }),
  restoreChapterRevision: (id, index, revisionId) => invoke('book:restoreRevision', { id, index, revisionId }),
  onProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('book:progress', listener);
    return () => ipcRenderer.removeListener('book:progress', listener);
  },

  // library
  listBooks: () => invoke('book:list'),
  getBook: (id) => invoke('book:get', id),
  deleteBook: (id) => invoke('book:delete', id),
  getBookHtml: (id) => invoke('book:html', id),
  getBookContent: (id) => invoke('book:content', id),

  // export & shell
  exportBook: (id, format, saveAs) => invoke('book:export', { id, format, saveAs }),
  openPath: (p) => invoke('shell:open', p),
  revealPath: (p) => invoke('shell:reveal', p),

  // kindle & email
  verifyKindle: () => invoke('kindle:verify'),
  sendToKindle: (id, format) => invoke('kindle:send', { id, format }),
  emailPdf: (id, to) => invoke('email:pdf', { id, to }),

  // menu events
  onMenu: (cb) => {
    const handlers = {
      'menu:new-book': () => cb('new-book'),
      'menu:settings': () => cb('settings'),
    };
    for (const [ch, h] of Object.entries(handlers)) ipcRenderer.on(ch, h);
    return () => {
      for (const ch of Object.keys(handlers)) ipcRenderer.removeAllListeners(ch);
    };
  },
});
