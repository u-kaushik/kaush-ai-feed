// ============================================================
// YouTube Feed — app.js
// Pure vanilla JS, no build tools, no dependencies.
// ============================================================

const SUPABASE_URL = 'https://thtcmxdcchxxbrsbkjar.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRodGNteGRjY2h4eGJyc2JramFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDU5MzUsImV4cCI6MjA4NjkyMTkzNX0.jIu-OHW6__OgMLa7PTrxTxh3LCGxp4fG-pDj0UZPBxw';

const QUERY =
  '/rest/v1/knowledge?source_type=in.(youtube,playbook)&chunk_index=eq.0' +
  '&select=id,title,source_url,content,tags,metadata,created_at' +
  '&order=created_at.desc&limit=200';

// ===== STATE =====
let allVideos = [];
let activeTagFilters = new Set();
let searchQuery = '';
let tagColorMap = {}; // tag → color index (0-7)
let channelColorMap = {}; // channel name → color index
let searchDebounceTimer = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  renderSkeletons();
  fetchVideos();

  document.getElementById('search-input').addEventListener('input', onSearch);
  document.getElementById('search-clear').addEventListener('click', clearSearch);
  document.getElementById('refresh-btn').addEventListener('click', () => {
    allVideos = [];
    activeTagFilters.clear();
    searchQuery = '';
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear').style.display = 'none';
    renderSkeletons();
    fetchVideos();
  });
});

// ===== FETCH =====
async function fetchVideos() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');

  try {
    const res = await fetch(SUPABASE_URL + QUERY, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    allVideos = data || [];

    buildTagColorMap();
    buildChannelColorMap();
    renderTagFilters();
    renderFeed();
    updateCount();
  } catch (err) {
    console.error('Fetch error:', err);
    renderError(err.message);
  } finally {
    btn.classList.remove('spinning');
  }
}

// ===== COLOR MAPS =====
function buildTagColorMap() {
  const allTags = new Set();
  allVideos.forEach(v => (v.tags || []).forEach(t => allTags.add(t)));
  let i = 0;
  allTags.forEach(tag => {
    tagColorMap[tag] = i % 8;
    i++;
  });
}

function buildChannelColorMap() {
  const allChannels = new Set();
  allVideos.forEach(v => allChannels.add(extractChannelName(v)));
  let i = 0;
  allChannels.forEach(ch => {
    channelColorMap[ch] = i % 8;
    i++;
  });
}

// ===== SEARCH =====
function onSearch(e) {
  const val = e.target.value;
  document.getElementById('search-clear').style.display = val ? 'flex' : 'none';
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = val.trim().toLowerCase();
    renderFeed();
  }, 200);
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  searchQuery = '';
  renderFeed();
}

// ===== TAG FILTER RENDER =====
function renderTagFilters() {
  // Count tag occurrences
  const tagCounts = {};
  allVideos.forEach(v => {
    (v.tags || []).forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });

  // Sort by frequency
  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  const container = document.getElementById('tag-filters');
  container.innerHTML = '';

  if (sortedTags.length === 0) return;

  sortedTags.forEach(tag => {
    const pill = document.createElement('button');
    pill.className =
      'tag-pill' + (activeTagFilters.has(tag) ? ' active' : '');
    pill.dataset.tag = tag;
    pill.innerHTML =
      escapeHtml(tag) +
      ` <span class="pill-count">${tagCounts[tag]}</span>`;
    pill.addEventListener('click', () => toggleTagFilter(tag));
    container.appendChild(pill);
  });
}

function toggleTagFilter(tag) {
  if (activeTagFilters.has(tag)) {
    activeTagFilters.delete(tag);
  } else {
    activeTagFilters.add(tag);
  }
  // Update pill active states
  document.querySelectorAll('.tag-pill').forEach(p => {
    p.classList.toggle('active', activeTagFilters.has(p.dataset.tag));
  });
  renderFeed();
}

// ===== FILTERED VIDEOS =====
function getFilteredVideos() {
  return allVideos.filter(v => {
    // Tag filter
    if (activeTagFilters.size > 0) {
      const vTags = new Set(v.tags || []);
      const match = [...activeTagFilters].every(t => vTags.has(t));
      if (!match) return false;
    }
    // Search filter
    if (searchQuery) {
      const haystack =
        (v.title || '').toLowerCase() + ' ' + (v.content || '').toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });
}

// ===== MAIN RENDER =====
function renderFeed() {
  const feed = document.getElementById('feed');
  const filtered = getFilteredVideos();

  if (allVideos.length === 0) {
    feed.innerHTML = emptyStateHTML();
    return;
  }

  if (filtered.length === 0) {
    feed.innerHTML = noResultsHTML();
    return;
  }

  // Group by date bucket
  const groups = groupByDate(filtered);
  const order = ['Today', 'Yesterday', 'This Week', 'Older'];

  let html = '';
  order.forEach(label => {
    const videos = groups[label];
    if (!videos || videos.length === 0) return;
    html += `<div class="date-group">`;
    html += `<div class="date-group-label">${label} <span style="font-weight:400;opacity:0.5">${videos.length}</span></div>`;
    videos.forEach(v => {
      html += renderCard(v);
    });
    html += `</div>`;
  });

  feed.innerHTML = html;

  // Attach expand/collapse listeners
  feed.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const summary = document.querySelector(`.summary-text[data-id="${id}"]`);
      const expanded = summary.classList.toggle('expanded');
      btn.textContent = expanded ? 'Show less' : 'Read more';
    });
  });

  // Attach card tag listeners (clicking a tag in a card toggles the filter)
  feed.querySelectorAll('.card-tag').forEach(el => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag;
      toggleTagFilter(tag);
    });
  });
}

// ===== CARD HTML =====
function renderCard(v) {
  const channelName = extractChannelName(v);
  const channelIdx = channelColorMap[channelName] ?? 0;
  const avatarLetter = channelName ? channelName[0].toUpperCase() : '?';
  const dateStr = formatDateShort(v.created_at);
  const tags = v.tags || [];
  const views = extractViews(v);
  const contentClean = extractSummary(v.content);
  const highlighted =
    searchQuery ? highlightText(contentClean, searchQuery) : escapeHtml(contentClean);
  const highlightedTitle =
    searchQuery
      ? highlightText(v.title || 'Untitled', searchQuery)
      : escapeHtml(v.title || 'Untitled');

  const cardTagsHTML = tags
    .map(tag => {
      const ci = tagColorMap[tag] ?? 0;
      const isActive = activeTagFilters.has(tag);
      return `<span class="card-tag tag-c-${ci}${isActive ? ' active' : ''}" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</span>`;
    })
    .join('');

  const viewsHTML = views
    ? `<span class="card-views">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        ${formatViews(views)}
       </span>`
    : '';

  const youtubeUrl = v.source_url || '#';

  return `
<div class="card">
  <div class="card-header">
    <div class="avatar av-${channelIdx}">${avatarLetter}</div>
    <div class="card-meta">
      <div class="card-channel">
        <span>${escapeHtml(channelName)}</span>
        <span class="card-channel-dot"></span>
        <span class="card-date">${dateStr}</span>
      </div>
      <div class="card-title">
        <a href="${escapeAttr(youtubeUrl)}" target="_blank" rel="noopener noreferrer">${highlightedTitle}</a>
      </div>
    </div>
  </div>
  <div class="card-summary">
    <div class="summary-text" data-id="${escapeAttr(v.id)}">${highlighted}</div>
    ${contentClean.length > 300 ? `<button class="expand-btn" data-id="${escapeAttr(v.id)}">Read more</button>` : ''}
  </div>
  ${(tags.length > 0 || views) ? `
  <div class="card-footer">
    <div class="card-tags">${cardTagsHTML}</div>
    ${viewsHTML}
  </div>` : ''}
</div>`;
}

// ===== SKELETONS =====
function renderSkeletons() {
  const feed = document.getElementById('feed');
  let html = '<div class="skeleton-group"><div class="skeleton-label"></div>';
  for (let i = 0; i < 3; i++) {
    html += `
<div class="skeleton-card">
  <div class="skeleton-row">
    <div class="skeleton-avatar"></div>
    <div class="skeleton-lines">
      <div class="skeleton-line w30"></div>
      <div class="skeleton-line title"></div>
    </div>
  </div>
  <div class="skeleton-lines" style="gap:6px">
    <div class="skeleton-line w100"></div>
    <div class="skeleton-line w80"></div>
    <div class="skeleton-line w60"></div>
  </div>
</div>`;
  }
  html += '</div>';
  html += '<div class="skeleton-group"><div class="skeleton-label"></div>';
  for (let i = 0; i < 2; i++) {
    html += `
<div class="skeleton-card">
  <div class="skeleton-row">
    <div class="skeleton-avatar"></div>
    <div class="skeleton-lines">
      <div class="skeleton-line w30"></div>
      <div class="skeleton-line title"></div>
    </div>
  </div>
  <div class="skeleton-lines" style="gap:6px">
    <div class="skeleton-line w100"></div>
    <div class="skeleton-line w60"></div>
  </div>
</div>`;
  }
  html += '</div>';
  feed.innerHTML = html;
}

// ===== EMPTY / NO RESULTS =====
function emptyStateHTML() {
  return `
<div class="empty-state">
  <div class="empty-icon">📺</div>
  <div class="empty-title">No videos yet</div>
  <div class="empty-sub">Channels are being watched. Check back soon.</div>
</div>`;
}

function noResultsHTML() {
  const filterDesc = [];
  if (searchQuery) filterDesc.push(`"${escapeHtml(searchQuery)}"`);
  if (activeTagFilters.size > 0)
    filterDesc.push([...activeTagFilters].map(t => `#${t}`).join(', '));

  return `
<div class="no-results">
  No videos match ${filterDesc.join(' + ')}.
  <br /><br />
  <button onclick="clearAllFilters()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:14px;font-family:var(--font);">Clear filters</button>
</div>`;
}

function clearAllFilters() {
  activeTagFilters.clear();
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  document.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
  renderFeed();
}

// ===== ERROR =====
function renderError(msg) {
  const feed = document.getElementById('feed');
  feed.innerHTML = `<div class="error-banner">Failed to load videos: ${escapeHtml(msg)}<br/><small>Check console for details.</small></div>`;
}

// ===== COUNT =====
function updateCount() {
  const el = document.getElementById('video-count');
  if (allVideos.length > 0) {
    el.textContent = `${allVideos.length} videos`;
  }
}

// ===== DATE GROUPING =====
function groupByDate(videos) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const groups = { Today: [], Yesterday: [], 'This Week': [], Older: [] };

  videos.forEach(v => {
    const d = new Date(v.created_at);
    if (d >= startOfToday) {
      groups['Today'].push(v);
    } else if (d >= startOfYesterday) {
      groups['Yesterday'].push(v);
    } else if (d >= startOfWeek) {
      groups['This Week'].push(v);
    } else {
      groups['Older'].push(v);
    }
  });

  return groups;
}

// ===== HELPERS =====
function extractChannelName(v) {
  // Try metadata.channel_url first
  const channelUrl = v.metadata && v.metadata.channel_url;
  if (channelUrl) {
    // e.g. https://youtube.com/@stevencravotta → stevencravotta
    const match = channelUrl.match(/@([\w.-]+)/);
    if (match) return formatHandle(match[1]);
    // fallback: last path segment
    const parts = channelUrl.replace(/\/$/, '').split('/');
    return formatHandle(parts[parts.length - 1]);
  }
  // Fallback: extract from title
  const titleMatch = (v.title || '').match(/\|\s*(.+)$/);
  if (titleMatch) return titleMatch[1].trim();
  return 'Unknown Channel';
}

function formatHandle(handle) {
  // "stevencravotta" → "stevencravotta" (keep as-is for conciseness)
  // Remove leading @ if present
  return handle.replace(/^@/, '');
}

function extractViews(v) {
  if (!v.metadata) return null;
  return v.metadata.view_count || null;
}

function formatViews(n) {
  if (!n) return '';
  const num = parseInt(n, 10);
  if (isNaN(num)) return String(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K views';
  return num + ' views';
}

function formatDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffHrs = diffMs / 3_600_000;
  const diffDays = diffMs / 86_400_000;

  if (diffHrs < 1) return 'Just now';
  if (diffHrs < 24) return `${Math.floor(diffHrs)}h ago`;
  if (diffDays < 2) return 'Yesterday';
  if (diffDays < 7) return `${Math.floor(diffDays)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function extractSummary(content) {
  if (!content) return '';
  // Strip markdown link syntax to plain text for the 3-line preview
  // Keep for expanded view - just return raw and let expanded show markdown-like
  return content;
}

function highlightText(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedQuery})`, 'gi'), '<mark>$1</mark>');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;');
}
