'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Unwrap the {ok,data,error} envelope from IPC handlers into a promise. */
async function invoke(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (res && res.ok) return res.data;
  throw new Error((res && res.error) || `IPC ${channel} failed`);
}

contextBridge.exposeInMainWorld('api', {
  // settings & meta
  getSettings: () => invoke('settings:get'),
  saveSettings: (partial) => invoke('settings:save', partial),
  getModels: () => invoke('meta:models'),

  // prerequisites
  checkPrerequisites: () => invoke('prereq:check'),
  checkAuth: (provider) => invoke('prereq:auth', provider),

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
