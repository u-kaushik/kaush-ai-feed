import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const feedPath = path.join(root, 'data', 'ai-feed.json');
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
      <div style="font-size:12px;color:#64748b;margin-top:10px;">${escapeHtml(item.author || 'Unknown')} · ${escapeHtml(
        item.published ? new Date(item.published).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date',
      )}</div>
    </div>
  `;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const raw = await readFile(feedPath, 'utf8');
  const items = JSON.parse(raw)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 8);

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#020617;font-family:Inter,Arial,sans-serif;color:#e2e8f0;">
    <div style="max-width:760px;margin:0 auto;padding:32px 20px;">
      <div style="margin-bottom:24px;">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#60a5fa;margin-bottom:10px;">AI Digest</div>
        <h1 style="margin:0;font-size:32px;line-height:1.1;color:#f8fafc;">Morning AI briefing</h1>
        <div style="margin-top:10px;font-size:14px;color:#94a3b8;">Top repos, tools, videos, and signal worth your attention this morning.</div>
      </div>
      ${items.map(renderCard).join('')}
      <div style="margin-top:24px;font-size:12px;color:#64748b;">Generated from ai-digest. Keep it lean, daily, and discussable.</div>
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
