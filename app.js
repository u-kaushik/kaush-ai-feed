// ============================================================
// YouTube Feed — app.js
// Pure vanilla JS, no build tools, no dependencies.
// ============================================================

// ===== THEME: Auto-switch based on time of day (UK) ===
function setTimeBasedTheme() {
  const now = new Date();
  
  // Get current hour in UK (GMT/BST)
  // UK time offset: GMT (winter) = 0, BST (summer) = +1
  const year = now.getFullYear();
  const march31 = new Date(year, 2, 31);
  const marchLastSunday = new Date(march31);
  marchLastSunday.setDate(march31.getDate() - march31.getDay());
  const bstStart = new Date(marchLastSunday);
  bstStart.setHours(1, 0, 0, 0);
  
  const oct31 = new Date(year, 9, 31);
  const octLastSunday = new Date(oct31);
  octLastSunday.setDate(oct31.getDate() - oct31.getDay());
  const bstEnd = new Date(octLastSunday);
  bstEnd.setHours(1, 0, 0, 0);
  
  const isBST = now >= bstStart && now < bstEnd;
  const ukOffset = isBST ? 1 : 0;
  
  // Get hour in UK
  const ukHour = (now.getUTCHours() + ukOffset) % 24;
  
  // Light mode: 6am to 6pm (daytime)
  // Dark mode: 6pm to 6am (evening/night)
  const isDaytime = ukHour >= 6 && ukHour < 18;
  
  if (isDaytime) {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
}

// Run on load
setTimeBasedTheme();

// Check every minute for hour changes
setInterval(() => {
  setTimeBasedTheme();
}, 60000);

const SUPABASE_URL = 'https://thtcmxdcchxxbrsbkjar.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRodGNteGRjY2h4eGJyc2JramFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDU5MzUsImV4cCI6MjA4NjkyMTkzNX0.jIu-OHW6__OgMLa7PTrxTxh3LCGxp4fG-pDj0UZPBxw';

const QUERY =
  '/rest/v1/knowledge?source_type=in.(youtube,playbook)&chunk_index=eq.0' +
  '&select=id,title,source_url,content,tags,metadata,created_at' +
  '&order=created_at.desc&limit=700';

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
    updateCount();
  }, 200);
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  searchQuery = '';
  renderFeed();
  updateCount();
}

// ===== TAG FILTER RENDER =====
function renderTagFilters() {
  // Count tag occurrences
  const tagCounts = {};
  allVideos.forEach(v => {
    let tags = v.tags;
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = []; }
    }
    (tags || []).forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });

  // Filter out useless tags (too generic, only 1 video, or in exclusion list)
  const excludeTags = ['youtube-feed', 'ai', 'dev'];
  const filteredTags = Object.entries(tagCounts)
    .filter(([tag, count]) => count > 1 && !excludeTags.includes(tag))
    .sort((a, b) => b[1] - a[1]);

  const container = document.getElementById('tag-filters');
  container.innerHTML = '';

  if (filteredTags.length === 0) return;

  filteredTags.forEach(([tag, count]) => {
    const pill = document.createElement('button');
    pill.className =
      'tag-pill' + (activeTagFilters.has(tag) ? ' active' : '');
    pill.dataset.tag = tag;
    pill.innerHTML =
      escapeHtml(tag) +
      ` <span class="pill-count">${count}</span>`;
    pill.addEventListener('click', () => toggleTagFilter(tag));
    container.appendChild(pill);
  });
}

function toggleTagFilter(tag) {
  // Single-select: clicking a new tag clears others
  if (!activeTagFilters.has(tag)) {
    activeTagFilters.clear();
    activeTagFilters.add(tag);
  } else {
    activeTagFilters.clear();
  }
  // Update pill active states
  document.querySelectorAll('.tag-pill').forEach(p => {
    p.classList.toggle('active', activeTagFilters.has(p.dataset.tag));
  });
  renderFeed();
  updateCount();
}

// ===== FILTERED VIDEOS =====
function getFilteredVideos() {
  return allVideos.filter(v => {
    // Tag filter - single select (OR logic)
    if (activeTagFilters.size > 0) {
      let vTags = v.tags;
      if (typeof vTags === 'string') {
        try { vTags = JSON.parse(vTags); } catch { vTags = []; }
      }
      const hasMatch = [...activeTagFilters].some(t => (vTags || []).includes(t));
      if (!hasMatch) return false;
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
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const expanded = document.getElementById(`expanded-${id}`);
      if (!expanded) return;
      const isVisible = expanded.style.display !== 'none';
      expanded.style.display = isVisible ? 'none' : 'block';
      btn.textContent = isVisible ? 'Read more' : 'Show less';
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
  // Use metadata.upload_date if available, fallback to created_at
  const meta = v.metadata;
  let uploadDate = null;
  if (meta && typeof meta === 'object') {
    uploadDate = meta.upload_date;
  }
  const dateStr = uploadDate ? formatDateShort(uploadDate) : formatDateShort(v.created_at);
  // Handle tags as JSON string or array
  let tags = v.tags;
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch { tags = []; }
  }
  tags = tags || [];
  const views = extractViews(v);
  const thumbnailUrl = extractThumbnail(v);

  // One-liner: use metadata.summary if available, else first sentence of content
  const oneLiner = extractOneLiner(v);
  const contentClean = extractSummary(v.content);
  const formattedContent = formatExpandedContent(contentClean);
  const highlightedSummary =
    searchQuery ? highlightText(oneLiner, searchQuery) : escapeHtml(oneLiner);
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
  const hasExpanded = contentClean.length > 200;

  return `
<div class="card">
  <a href="${escapeAttr(youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="card-link">
    <div class="card-body">
      <div class="card-thumb">
        <img src="${escapeAttr(thumbnailUrl)}" alt="" loading="lazy" onerror="this.style.display='none'" />
      </div>
      <div class="card-right">
        <div class="card-topline">
          <span class="card-channel">${escapeHtml(channelName)}</span>
          <span class="card-channel-dot"></span>
          <span class="card-date">${dateStr}</span>
        </div>
        <div class="card-title">${highlightedTitle}</div>
        <div class="card-oneliner">${highlightedSummary}</div>
        ${hasExpanded ? `<button class="expand-btn" data-id="${escapeAttr(v.id)}">Read more</button>` : ''}
      </div>
    </div>
  </a>
  ${hasExpanded ? `<div class="card-expanded" id="expanded-${escapeAttr(v.id)}" style="display:none">${searchQuery ? highlightText(formattedContent, searchQuery) : formattedContent}</div>` : ''}
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
  <div class="skeleton-thumb"></div>
  <div class="skeleton-lines">
    <div class="skeleton-line w30"></div>
    <div class="skeleton-line title"></div>
    <div class="skeleton-line oneline"></div>
    <div class="skeleton-line w80"></div>
  </div>
</div>`;
  }
  html += '</div>';
  html += '<div class="skeleton-group"><div class="skeleton-label"></div>';
  for (let i = 0; i < 2; i++) {
    html += `
<div class="skeleton-card">
  <div class="skeleton-thumb"></div>
  <div class="skeleton-lines">
    <div class="skeleton-line w30"></div>
    <div class="skeleton-line title"></div>
    <div class="skeleton-line oneline"></div>
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
    if (activeTagFilters.size > 0) {
      const filtered = getFilteredVideos();
      el.textContent = `${filtered.length} of ${allVideos.length} videos`;
    } else {
      // Only count videos from the last 7 days (the ones we actually show)
      const now = new Date();
      const weekAgo = new Date(now - 7 * 86400000);
      const recent = allVideos.filter(v => {
        const meta = v.metadata;
        let uploadDate = null;
        if (meta && typeof meta === 'object') {
          uploadDate = meta.upload_date;
        }
        const d = uploadDate ? new Date(uploadDate) : new Date(v.created_at);
        return d >= weekAgo;
      });
      el.textContent = `${recent.length} videos (last 7 days)`;
    }
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

  const groups = { Today: [], Yesterday: [], 'This Week': [] };

  videos.forEach(v => {
    const meta = v.metadata;
    let uploadDate = null;
    if (meta && typeof meta === 'object') {
      uploadDate = meta.upload_date;
    }
    const d = uploadDate ? new Date(uploadDate) : new Date(v.created_at);
    if (d >= startOfToday) {
      groups['Today'].push(v);
    } else if (d >= startOfYesterday) {
      groups['Yesterday'].push(v);
    } else if (d >= startOfWeek) {
      groups['This Week'].push(v);
    }
    // Skip older than a week
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

function extractThumbnail(v) {
  const videoId = extractVideoId(v.source_url);
  if (videoId) return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  return '';
}

function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function extractOneLiner(v) {
  // Prefer stored summary in metadata
  let summary = '';
  if (v.metadata && typeof v.metadata === 'object') {
    summary = v.metadata.summary || '';
  }
  if (summary) {
    // Clean up: remove title prefix, "Transcript [00:00]", and "Source:" lines
    summary = summary.replace(/^.*Transcript\s*\[\d{2}:\d{2}\]\s*/, '');
    summary = summary.replace(/^Source:.*$/m, '');
    summary = summary.replace(/^\*\*Source:\*\*.*$/m, '');
    summary = summary.trim();
    // Take first sentence
    const sentenceMatch = summary.match(/^([^.!?\n]+[.!?])/);
    if (sentenceMatch && sentenceMatch[1].length > 15) {
      return sentenceMatch[1].trim();
    }
    // Or first 150 chars
    return summary.substring(0, 150).replace(/\n/g, ' ').trim();
  }
  // Fallback: first sentence or first 150 chars of content
  const content = v.content || '';
  const clean = content.replace(/^#+\s*/gm, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  const sentenceMatch = clean.match(/^([^.!?\n]+[.!?])/);
  if (sentenceMatch && sentenceMatch[1].length > 20) return sentenceMatch[1].trim();
  return clean.substring(0, 150).replace(/\n/g, ' ').trim();
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
  return ''; // Don't show dates older than a week
}

function extractSummary(content) {
  if (!content) return '';
  // Strip markdown link syntax to plain text for the 3-line preview
  // Keep for expanded view - just return raw and let expanded show markdown-like
  return content;
}

function formatExpandedContent(content) {
  if (!content) return '';
  // Remove title line (starts with #)
  let text = content.replace(/^#\s*.+$/gm, '').trim();
  // Remove Source: line
  text = text.replace(/^\*\*Source:\*\*.*$/gm, '').replace(/^Source:.*$/gm, '');
  // Remove Views: line
  text = text.replace(/^\*\*Views:\*\*.*$/gm, '').replace(/^Views:.*$/gm, '');
  // Remove Description header
  text = text.replace(/^##\s*Description\s*$/gm, '').replace(/^##\s*Transcript\s*$/gm, '');
  // Remove timestamp brackets like [00:00]
  text = text.replace(/\[\d{2}:\d{2}\]/g, '');
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return '';
  // Split into sentences and make bullet points
  const sentences = text.split(/(?<=[.!?])\s+/);
  const bullets = [];
  const seen = new Set();
  for (let sentence of sentences) {
    sentence = sentence.trim();
    if (!sentence || sentence.length < 15) continue;
    // Clean up the sentence
    sentence = sentence.replace(/^[\-\*•\s]+/, '').replace(/\s+/g, ' ');
    if (sentence.length < 15) continue;
    // Deduplicate similar starts
    const key = sentence.substring(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(sentence);
  }
  // Join with line breaks
  return bullets.slice(0, 15).map(s => `• ${s}`).join('\n');
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
