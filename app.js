// ============================================================
// YouTube Feed — app.js
// Pure vanilla JS, no build tools, no dependencies.
// ============================================================

let manualTheme = null;

function setTimeBasedTheme() {
  if (manualTheme !== null) return;
  
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

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  if (isDark) {
    document.documentElement.classList.remove('dark');
    manualTheme = 'light';
  } else {
    document.documentElement.classList.add('dark');
    manualTheme = 'dark';
  }
  localStorage.setItem('theme', manualTheme);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    manualTheme = saved;
    if (saved === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } else {
    setTimeBasedTheme();
  }
}

// Run on load
initTheme();

// Check every minute for hour changes (only if no manual override)
setInterval(() => {
  if (manualTheme === null) {
    setTimeBasedTheme();
  }
}, 60000);

const FEED_URL = 'data/yt-feed.json';
const SUPABASE_URL = 'https://thtcmxdcchxxbrsbkjar.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRodGNteGRjY2h4eGJyc2JramFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDU5MzUsImV4cCI6MjA4NjkyMTkzNX0.jIu-OHW6__OgMLa7PTrxTxh3LCGxp4fG-pDj0UZPBxw';

const FAVES_TABLE = '/rest/v1/favorites?source=eq.youtube-feed';

// ===== STATE =====
let allVideos = [];
let favorites = new Set();
let activeTagFilters = new Set();
let activeChannelFilter = null;
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
    activeChannelFilter = null;
    searchQuery = '';
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear').style.display = 'none';
    renderSkeletons();
    fetchVideos();
  });
  document.getElementById('clear-channel-filter').addEventListener('click', clearChannelFilter);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
});

// ===== FETCH =====
async function fetchVideos() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');

  try {
    // Fetch the JSON feed
    const feedRes = await fetch(FEED_URL);
    console.log('Feed fetch:', feedRes.status, feedRes.ok);
    if (feedRes.ok) {
      const data = await feedRes.json();
      console.log('Got videos:', data.length);
      allVideos = data;
    } else {
      console.warn('Feed fetch failed, status:', feedRes.status);
      allVideos = [];
    }

    // Fetch favorites from Supabase
    try {
      const favesRes = await fetch(SUPABASE_URL + FAVES_TABLE, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        },
      });
      if (favesRes.ok) {
        const favesData = await favesRes.json();
        favorites = new Set((favesData || []).map(f => f.video_url));
      }
    } catch (e) {
      console.warn('Could not fetch favorites:', e.message);
    }

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
  // Only count tags from videos we actually show (last 7 days)
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000);
  
  const recentVideos = allVideos.filter(v => {
    const meta = v.metadata;
    let uploadDate = null;
    if (meta && typeof meta === 'object') {
      uploadDate = meta.upload_date;
    }
    const d = uploadDate ? new Date(uploadDate) : new Date(v.created_at);
    return d >= weekAgo;
  });

  // Count tag occurrences
  const tagCounts = {};
  recentVideos.forEach(v => {
    let tags = v.tags;
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = []; }
    }
    (tags || []).forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });

  // Filter out useless tags
  const excludeTags = ['youtube-feed', 'ai', 'dev', 'Coding', 'AI'];
  const filteredTags = Object.entries(tagCounts)
    .filter(([tag, count]) => count > 0 && !excludeTags.includes(tag))
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

function toggleChannelFilter(channel) {
  if (activeChannelFilter === channel) {
    activeChannelFilter = null;
  } else {
    activeChannelFilter = channel;
  }
  renderChannelFilterBar();
  renderFeed();
  updateCount();
}

function clearChannelFilter() {
  activeChannelFilter = null;
  renderChannelFilterBar();
  renderFeed();
  updateCount();
}

async function toggleFavorite(url, btnEl) {
  const isFave = favorites.has(url);
  
  try {
    if (isFave) {
      // Remove from Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/favorites?video_url=eq.${encodeURIComponent(url)}`, {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        },
      });
      favorites.delete(url);
    } else {
      // Add to Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/favorites`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          video_url: url,
          source: 'youtube-feed',
          favorited_at: new Date().toISOString(),
        }),
      });
      favorites.add(url);
    }
    
    // Update button UI
    btnEl.classList.toggle('active', !isFave);
    const svg = btnEl.querySelector('svg');
    svg.setAttribute('fill', isFave ? 'none' : 'currentColor');
    btnEl.title = isFave ? 'Add to favorites' : 'Remove from favorites';
  } catch (e) {
    console.error('Failed to toggle favorite:', e.message);
  }
}

function renderChannelFilterBar() {
  const bar = document.getElementById('channel-filter-bar');
  const nameEl = document.getElementById('active-channel-name');
  if (activeChannelFilter) {
    nameEl.textContent = '@' + activeChannelFilter;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

// ===== FILTERED VIDEOS =====
function getFilteredVideos() {
  return allVideos.filter(v => {
    // Channel filter
    if (activeChannelFilter) {
      const channelName = extractChannelName(v);
      if (channelName !== activeChannelFilter) return false;
    }
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
      const haystack = (v.title || '').toLowerCase();
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

  // Sort by upload date (newest first)
  const sorted = [...filtered].sort((a, b) => {
    const aDate = getUploadDate(a);
    const bDate = getUploadDate(b);
    return new Date(bDate) - new Date(aDate);
  });

  // Group by date bucket
  const groups = groupByDate(sorted);
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

  // Attach channel filter listeners
  feed.querySelectorAll('.card-channel-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const channel = el.dataset.channel;
      toggleChannelFilter(channel);
    });
  });

  // Attach favorite button listeners
  feed.querySelectorAll('.fave-btn').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = el.dataset.url;
      await toggleFavorite(url, el);
    });
  });
}

// ===== CARD HTML =====
function renderCard(v) {
  const channelName = extractChannelName(v);
  const channelIdx = channelColorMap[channelName] ?? 0;
  const meta = v.metadata;
  let uploadDate = null;
  if (meta && typeof meta === 'object') {
    uploadDate = meta.upload_date;
  }
  const timestamp = v.published || v.created_at;
  let tags = v.tags || [];
  const thumbnailUrl = v.thumbnail || '';

  const cardTagsHTML = tags
    .filter(t => !['youtube-feed', 'ai', 'dev', 'Coding', 'AI'].includes(t))
    .map(tag => {
      const ci = tagColorMap[tag] ?? 0;
      const isActive = activeTagFilters.has(tag);
      return `<span class="card-tag tag-c-${ci}${isActive ? ' active' : ''}" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</span>`;
    })
    .join('');

  const youtubeUrl = v.url || v.source_url || '#';
  const isFave = favorites.has(youtubeUrl);

  return `
<div class="card">
  <div class="card-body">
    <a href="${escapeAttr(youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="card-link">
      <div class="card-thumb">
        <img src="${escapeAttr(thumbnailUrl)}" alt="" loading="lazy" onerror="this.style.display='none'" />
      </div>
      <div class="card-right">
        <button class="card-channel-btn" data-channel="${escapeAttr(channelName)}" title="Filter by ${escapeHtml(channelName)}">${escapeHtml(channelName)}</button>
        <div class="card-title">${escapeHtml(v.title || 'Untitled')}</div>
        <div class="card-timestamp">${formatDateTime(timestamp)}</div>
      </div>
    </a>
    <button class="fave-btn ${isFave ? 'active' : ''}" data-url="${escapeAttr(youtubeUrl)}" title="${isFave ? 'Remove from favorites' : 'Add to favorites'}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFave ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </button>
  </div>
  ${(tags.length > 0) ? `
  <div class="card-footer">
    <div class="card-tags">${cardTagsHTML}</div>
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
  if (activeChannelFilter) filterDesc.push(`@${activeChannelFilter}`);
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
  activeChannelFilter = null;
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
    
    const filtered = getFilteredVideos();
    if (activeTagFilters.size > 0 || activeChannelFilter) {
      el.textContent = `${filtered.length} videos`;
    } else {
      el.textContent = `${recent.length} videos`;
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
function getUploadDate(v) {
  const meta = v.metadata;
  if (meta && typeof meta === 'object' && meta.upload_date) {
    return meta.upload_date;
  }
  return v.created_at;
}

function extractChannelName(v) {
  // New format has channel directly
  if (v.channel) return v.channel;
  // Old format: try metadata.channel_url first
  const channelUrl = v.metadata && v.metadata.channel_url;
  if (channelUrl) {
    const match = channelUrl.match(/@([\w.-]+)/);
    if (match) return formatHandle(match[1]);
    const parts = channelUrl.replace(/\/$/, '').split('/');
    return formatHandle(parts[parts.length - 1]);
  }
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

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${time} • ${date}`;
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
  text = text.replace(/\[\d{2}:\d{2}\]\s*/g, '');
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
  
  // Build HTML with proper formatting
  return bullets.slice(0, 15).map(s => `<div style="margin-bottom:6px;padding-left:16px;position:relative"><span style="position:absolute;left:0;color:var(--accent)">•</span>${escapeHtml(s)}</div>`).join('');
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
