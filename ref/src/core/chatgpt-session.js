// Parses a ChatGPT login session pasted by the user, for accounts that sign
// in with Google (Google refuses sign-in inside embedded browsers). Accepts:
//   - a Cookie request header ("a=1; __Secure-next-auth.session-token=…; …"),
//     or "name=value" / "name: value" pairs one per line
//   - the bare session-token value
//   - a cookie-export JSON array ([{ name, value, … }])
// Only the session-token cookie (possibly split into .0, .1, …) is kept.

const SESSION_COOKIE = /^__Secure-next-auth\.session-token(\.\d+)?$/;

/** @returns {Array<{name: string, value: string}>} */
function parseSessionInput(input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('Nothing pasted');

  let pairs;
  if (text.startsWith('[') || text.startsWith('{')) {
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('Pasted JSON is not valid'); }
    pairs = [].concat(data).filter(c => c && typeof c.name === 'string').map(c => ({ name: c.name, value: String(c.value ?? '') }));
  } else if (/[=;:\n]/.test(text.replace(/^cookie:\s*/i, ''))) {
    // Session tokens are base64url and never contain "=" or ":", so either separates name and value.
    // A name may sit alone on its line ("…token.0:") with the value on the next non-blank line.
    const parts = text.replace(/^cookie:\s*/i, '').split(/[;\n]/).map(p => p.trim()).filter(Boolean);
    pairs = [];
    for (let i = 0; i < parts.length; i++) {
      const at = parts[i].search(/[=:]/);
      if (at < 0) continue;
      const pair = { name: parts[i].slice(0, at).trim(), value: parts[i].slice(at + 1).trim() };
      if (!pair.value && i + 1 < parts.length && parts[i + 1].search(/[=:]/) < 0) pair.value = parts[++i];
      pairs.push(pair);
    }
  } else {
    pairs = [{ name: '__Secure-next-auth.session-token', value: text }];
  }

  const session = pairs.filter(c => SESSION_COOKIE.test(c.name) && c.value);
  if (!session.length) throw new Error('No __Secure-next-auth.session-token cookie found in what was pasted');
  return session;
}

module.exports = { parseSessionInput, SESSION_COOKIE };
