const FEED_URL = 'data/ai-feed.json';
const SAVED_URL = 'data/saved-items.json';
const NOTES_URL = 'data/digest-notes.json';

let manualTheme = null;

function setTimeBasedTheme() {
  if (manualTheme !== null) return;
  const hour = new Date().getHours();
  const isDaytime = hour >= 6 && hour < 18;
  document.documentElement.classList.toggle('dark', !isDaytime);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    manualTheme = saved;
    document.documentElement.classList.toggle('dark', saved === 'dark');
  } else {
    setTimeBasedTheme();
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(iso) {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function relativeLabel(iso) {
  if (!iso) return 'No date';
  const diffHours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3600000));
  if (diffHours < 24) return `${diffHours || 1}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(iso);
}

function metricLine(metrics) {
  if (!metrics || typeof metrics !== 'object') return '';
  const entries = Object.entries(metrics).filter(([, value]) => value != null && value !== '');
  if (!entries.length) return '';
  return `<div class="digest-meta-line">${entries
    .map(([key, value]) => `<span class="digest-chip"><strong>${escapeHtml(key)}</strong> ${escapeHtml(value)}</span>`)
    .join('')}</div>`;
}

function renderCard(item) {
  return `
    <article class="digest-card">
      <div class="digest-card-top">
        <span class="digest-source">${escapeHtml(item.source || item.type || 'Item')}</span>
        <span class="digest-time">${escapeHtml(relativeLabel(item.published))}</span>
      </div>
      <h3><a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || 'Untitled')}</a></h3>
      <p class="digest-summary">${escapeHtml(item.summary || '')}</p>
      ${item.why_it_matters ? `<p class="digest-why"><strong>Why it matters:</strong> ${escapeHtml(item.why_it_matters)}</p>` : ''}
      ${metricLine(item.metrics)}
      <div class="digest-footer">
        <span>${escapeHtml(item.author || 'Unknown')}</span>
        <span>score ${escapeHtml(item.score || '')}</span>
      </div>
    </article>
  `;
}

function renderWrap(savedItems, notes) {
  const recentSaved = savedItems.slice(0, 8);
  const recentNotes = notes.slice(0, 8);
  if (!recentSaved.length && !recentNotes.length) return '';
  return `
    <section class="digest-wrapup">
      <div class="section-kicker">Friday wrap-up preview</div>
      ${recentSaved.length ? `
        <div class="wrap-block">
          <h2>Saved items</h2>
          <ul>
            ${recentSaved.map((item) => `<li><a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || 'Untitled')}</a></li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${recentNotes.length ? `
        <div class="wrap-block">
          <h2>Notes and watched items</h2>
          <ul>
            ${recentNotes.map((note) => `<li>${escapeHtml(note.text || note.note || '')}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </section>
  `;
}

async function readJson(url, fallback) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return fallback;
  }
}

async function initDigestPage() {
  initTheme();

  const [feed, savedItems, notes] = await Promise.all([
    readJson(FEED_URL, []),
    readJson(SAVED_URL, []),
    readJson(NOTES_URL, []),
  ]);

  const items = [...feed]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 8);

  document.getElementById('digest-date').textContent = formatDate(new Date().toISOString());
  document.getElementById('digest-count').textContent = `${items.length} items`;
  document.getElementById('digest-feed').innerHTML = items.length
    ? items.map(renderCard).join('')
    : '<div class="empty-state"><div class="empty-title">No digest items yet</div></div>';
  document.getElementById('digest-wrap-slot').innerHTML = renderWrap(savedItems, notes);
}

document.addEventListener('DOMContentLoaded', initDigestPage);
