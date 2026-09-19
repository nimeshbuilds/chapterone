'use strict';

/** Terminal login is the only shell invocation; commands are paths, not scripts. */
function loginCommand(command, args = [], platform = process.platform) {
  const values = [command, ...args].map(String);
  if (!command || values.some((s) => /[\0\r\n]/.test(s))) throw new Error('Invalid CLI executable path.');
  if (platform === 'win32') {
    // cmd expands these even in quotes. Refuse rather than execute a different command.
    if (values.some((s) => /["%!^&|<>]/.test(s))) throw new Error('The CLI path contains unsupported Windows shell characters.');
    return values.map((s) => `"${s}"`).join(' ');
  }
  return values.map((s) => "'" + s.replace(/'/g, "'\\''") + "'").join(' ');
}

module.exports = { loginCommand };
