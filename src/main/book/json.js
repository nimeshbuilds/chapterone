'use strict';

/**
 * Extract the first balanced JSON object/array from a model's text output.
 * Tolerates code fences and surrounding prose.
 * @param {string} text
 * @returns {any}
 */
function extractJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('No text to parse JSON from');
  }

  // Strip ```json ... ``` fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;

  // Try a direct parse first.
  const direct = tryParse(candidate.trim());
  if (direct.ok) return direct.value;

  // Otherwise scan for the first balanced { } or [ ] block.
  const block = firstBalancedBlock(candidate);
  if (block) {
    const parsed = tryParse(block);
    if (parsed.ok) return parsed.value;
  }

  throw new Error('Could not parse JSON from model output');
}

function tryParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (_) {
    return { ok: false };
  }
}

function firstBalancedBlock(text) {
  const opens = { '{': '}', '[': ']' };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (opens[ch]) {
      const close = opens[ch];
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === ch) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) return text.slice(i, j + 1);
        }
      }
    }
  }
  return null;
}

module.exports = { extractJson };
