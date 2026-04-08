import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const feedPath = path.join(dataDir, 'ai-feed.json');
const savedItemsPath = path.join(dataDir, 'saved-items.json');
const digestNotesPath = path.join(dataDir, 'digest-notes.json');
const outDir = path.join(root, 'out');
const outPath = path.join(outDir, 'morning-email.html');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function readJson(pathname, fallback) {
  try {
    const raw = await readFile(pathname, 'utf8');
    return safeJsonParse(raw, fallback);
  } catch {
    return fallback;
  }
}

function formatDate(iso) {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function metricLine(metrics) {
  if (!metrics || typeof metrics !== 'object') return '';
  const entries = Object.entries(metrics).filter(([, value]) => value != null && value !== '');
  if (!entries.length) return '';
  return `<div style="font-size:12px;color:#94a3b8;margin-top:8px">${entries
    .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(value)}`)
    .join(' · ')}</div>`;
}

function renderCard(item) {
  return `
    <div style="background:#111827;border:1px solid #1f2937;border-radius:14px;padding:18px 18px 16px;margin-bottom:14px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#60a5fa;margin-bottom:8px;">${escapeHtml(item.source || item.type || 'Item')}</div>
      <div style="font-size:18px;line-height:1.35;font-weight:700;color:#f8fafc;margin-bottom:8px;">
        <a href="${escapeHtml(item.url || '#')}" style="color:#f8fafc;text-decoration:none;">${escapeHtml(item.title || 'Untitled')}</a>
      </div>
      <div style="font-size:13px;line-height:1.6;color:#cbd5e1;margin-bottom:8px;">${escapeHtml(item.summary || '')}</div>
      ${item.why_it_matters ? `<div style="font-size:13px;line-height:1.6;color:#e2e8f0;"><strong>Why it matters:</strong> ${escapeHtml(item.why_it_matters)}</div>` : ''}
      ${metricLine(item.metrics)}
      <div style="font-size:12px;color:#64748b;margin-top:10px;">${escapeHtml(item.author || 'Unknown')} · ${escapeHtml(formatDate(item.published))}</div>
    </div>
  `;
}

function weekWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  return { start, now };
}

function isInLastWeek(iso) {
  if (!iso) return false;
  const date = new Date(iso);
  const { start, now } = weekWindow();
  return date >= start && date <= now;
}

function renderSavedSection(savedItems, digestNotes) {
  const recentSaved = savedItems.filter((item) => isInLastWeek(item.saved_at || item.updated_at || item.published));
  const recentNotes = digestNotes.filter((note) => isInLastWeek(note.created_at || note.updated_at));
  if (!recentSaved.length && !recentNotes.length) return '';

  return `
    <div style="margin:28px 0 20px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f59e0b;margin-bottom:10px;">Friday wrap-up</div>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:18px;">
        ${recentSaved.length ? `
          <div style="font-size:15px;font-weight:700;color:#f8fafc;margin-bottom:10px;">Saved items this week</div>
          <ul style="margin:0 0 16px;padding-left:18px;color:#cbd5e1;">
            ${recentSaved
              .slice(0, 12)
              .map(
                (item) => `<li style="margin-bottom:8px;"><a href="${escapeHtml(item.url || '#')}" style="color:#93c5fd;text-decoration:none;">${escapeHtml(item.title || 'Untitled')}</a>${item.note ? `, ${escapeHtml(item.note)}` : ''}</li>`,
              )
              .join('')}
          </ul>
        ` : ''}
        ${recentNotes.length ? `
          <div style="font-size:15px;font-weight:700;color:#f8fafc;margin-bottom:10px;">Conversation notes and watched items</div>
          <ul style="margin:0;padding-left:18px;color:#cbd5e1;">
            ${recentNotes
              .slice(0, 12)
              .map(
                (note) => `<li style="margin-bottom:8px;">${escapeHtml(note.text || note.note || '')}${note.url ? `, <a href="${escapeHtml(note.url)}" style="color:#93c5fd;text-decoration:none;">link</a>` : ''}</li>`,
              )
              .join('')}
          </ul>
        ` : ''}
      </div>
    </div>
  `;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const [feedItems, savedItems, digestNotes] = await Promise.all([
    readJson(feedPath, []),
    readJson(savedItemsPath, []),
    readJson(digestNotesPath, []),
  ]);

  const items = feedItems
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 8);

  const isFriday = new Date().getDay() === 5;
  const recapBlock = isFriday ? renderSavedSection(savedItems, digestNotes) : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#020617;font-family:Inter,Arial,sans-serif;color:#e2e8f0;">
    <div style="max-width:760px;margin:0 auto;padding:32px 20px;">
      <div style="margin-bottom:24px;">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#60a5fa;margin-bottom:10px;">AI Digest</div>
        <h1 style="margin:0;font-size:32px;line-height:1.1;color:#f8fafc;">Morning AI briefing</h1>
        <div style="margin-top:10px;font-size:14px;color:#94a3b8;">Top repos, tools, videos, and signal worth your attention this morning.</div>
      </div>
      ${recapBlock}
      ${items.map(renderCard).join('')}
      <div style="margin-top:24px;font-size:12px;color:#64748b;">Generated from ai-digest. Daily feed stays local by default. Saved items and notes can power Friday recap later.</div>
    </div>
  </body>
</html>`;

  await writeFile(outPath, html);
  console.log(`ai-digest: wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
