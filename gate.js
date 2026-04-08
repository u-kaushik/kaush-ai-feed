const DIGEST_GATE = {
  storageKey: 'ai-digest-unlocked',
  passwordHash: 'd445d6f02dffa99c35b18a71ca2ceca01c21520d259055727f2104a26a68412e',
  promptTitle: 'Private digest',
  promptBody: 'This digest is lightly gated while it is live on the public web.',
};

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  return hex(await crypto.subtle.digest('SHA-256', encoded));
}

function gateMarkup() {
  return `
    <div class="gate-shell">
      <div class="gate-card">
        <div class="gate-badge">Jarvis</div>
        <h1>${DIGEST_GATE.promptTitle}</h1>
        <p>${DIGEST_GATE.promptBody}</p>
        <form id="gate-form" class="gate-form">
          <input id="gate-input" type="password" placeholder="Enter password" autocomplete="current-password" />
          <button type="submit">Unlock</button>
        </form>
        <div id="gate-error" class="gate-error"></div>
      </div>
    </div>
  `;
}

async function bootGate() {
  if (localStorage.getItem(DIGEST_GATE.storageKey) === '1') return;
  if (!document.body) return;

  document.documentElement.classList.add('gate-active');
  document.body.innerHTML = gateMarkup();

  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-input');
  const error = document.getElementById('gate-error');
  input.focus();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const attempt = input.value.trim();
    if (!attempt) return;
    const hashed = await sha256(attempt);
    if (hashed === DIGEST_GATE.passwordHash) {
      localStorage.setItem(DIGEST_GATE.storageKey, '1');
      window.location.reload();
      return;
    }
    error.textContent = 'Wrong password.';
    input.select();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootGate, { once: true });
} else {
  bootGate();
}
