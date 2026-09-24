'use strict';

/** Electron only overrides a renderer's unload veto after explicit discard. */
function protectUnsavedChanges(win, dialog) {
  win.webContents.on('will-prevent-unload', (event) => {
    let choice;
    try {
      choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        title: 'Unsaved chapter edits',
        message: 'Keep editing your chapter?',
        detail: 'Your latest edits have not been saved. Discarding changes leaves the last saved chapter unchanged.',
        buttons: ['Keep editing', 'Discard changes'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
    } catch (_) { return; } // If the native dialog fails, preserve unsaved work.
    // For this Electron event, preventDefault means allow the page to unload.
    if (choice === 1) event.preventDefault();
  });
}

module.exports = { protectUnsavedChanges };
