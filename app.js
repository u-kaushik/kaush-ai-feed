let manualTheme = null;
let allItems = [];
let activeTagFilters = new Set();
let activeChannelFilter = null;
let searchQuery = '';
let searchDebounceTimer = null;

const FEED_URL = 'data/ai-feed.json';

function setTimeBasedTheme() {
  if (manualTheme !== null) return;
  const hour = new Date().getHours();
  const isDaytime = hour >= 6 && hour < 18;
  document.documentElement.classList.toggle('dark', !isDaytime);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', !isDark);
  manualTheme = isDark ? 'light' : 'dark';
  localStorage.setItem('theme', manualTheme);
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

function sourceLabel(item) {
  return item.source || item.type || 'Item';
}

function authorLabel(item) {
  return item.author || 'Unknown';
}

function formatRelativeDate(iso) {
  if (!iso) return 'No date';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffHours = Math.max(0, Math.floor(diffMs / 3600000));
  if (diffHours < 24) return `${diffHours || 1}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function metricIcon(key) {
  const normalized = String(key || '').toLowerCase();
  if (normalized === 'stars') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.57 5.2 5.74.83-4.15 4.04.98 5.71L12 16.86l-5.14 2.72.98-5.71L3.69 9.83l5.74-.83L12 3.8z" fill="currentColor"/></svg>`;
  }
  if (normalized === 'forks') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm10 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM7 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm1-6v3.2c0 .6.24 1.18.66 1.6l1.88 1.88c.42.42.66 1 .66 1.6V19h2v-1.72c0-1.13-.45-2.22-1.24-3.02l-1.88-1.88A4.27 4.27 0 0 1 10 9.2V9h4.17A2.99 2.99 0 0 0 17 12h2a4.99 4.99 0 0 1-4.83-4H8z" fill="currentColor"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>`;
}

function metricHtml(metrics) {
  if (!metrics || typeof metrics !== 'object') return '';
  const entries = Object.entries(metrics).filter(([, value]) => value != null && value !== '');
  if (!entries.length) return '';
  return `<div class="card-tags card-metrics" style="margin-top:10px">${entries
    .map(
      ([key, value]) => `<span class="tag-chip metric-chip metric-chip-${escapeHtml(String(key).toLowerCase())}">${metricIcon(key)}<span>${escapeHtml(value)}</span></span>`,
    )
    .join('')}</div>`;
}

function buildTagFilters() {
  const counts = new Map();
  allItems.forEach((item) => {
    (item.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });

  const container = document.getElementById('tag-filters');
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  container.innerHTML = tags
    .map(
      ([tag, count]) =>
        `<button class="tag-pill ${activeTagFilters.has(tag) ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)} <span class="pill-count">${count}</span></button>`,
    )
    .join('');

  container.querySelectorAll('.tag-pill').forEach((pill) => {
    pill.addEventListener('click', () => toggleTagFilter(pill.dataset.tag));
  });
}

function toggleTagFilter(tag) {
  if (!tag) return;
  if (activeTagFilters.has(tag)) activeTagFilters.clear();
  else {
    activeTagFilters.clear();
    activeTagFilters.add(tag);
  }
  buildTagFilters();
  renderFeed();
  updateCount();
}

function toggleSourceFilter(source) {
  activeChannelFilter = activeChannelFilter === source ? null : source;
  renderChannelFilterBar();
  renderFeed();
  updateCount();
}

function renderChannelFilterBar() {
  const bar = document.getElementById('channel-filter-bar');
  const nameEl = document.getElementById('active-channel-name');
  if (activeChannelFilter) {
    nameEl.textContent = activeChannelFilter;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

function getFilteredItems() {
  return allItems.filter((item) => {
    if (activeChannelFilter && sourceLabel(item) !== activeChannelFilter) return false;
    if (activeTagFilters.size > 0) {
      const tags = Array.isArray(item.tags) ? item.tags : [];
      if (![...activeTagFilters].some((tag) => tags.includes(tag))) return false;
    }
    if (searchQuery) {
      const haystack = [
        item.title,
        item.summary,
        item.why_it_matters,
        authorLabel(item),
        sourceLabel(item),
        ...(item.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });
}

function groupByDate(items) {
  const groups = { Today: [], Yesterday: [], 'This Week': [], Older: [] };
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startToday.getDate() - 1);
  const weekAgo = new Date(startToday);
  weekAgo.setDate(startToday.getDate() - 7);

  items.forEach((item) => {
    const date = item.published ? new Date(item.published) : now;
    if (date >= startToday) groups.Today.push(item);
    else if (date >= startYesterday) groups.Yesterday.push(item);
    else if (date >= weekAgo) groups['This Week'].push(item);
    else groups.Older.push(item);
  });

  return groups;
}

function sourceIcon(item) {
  const source = sourceLabel(item).toLowerCase();
  if (source.includes('github')) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2.17c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.3 1.18-3.12-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.19 1.19a11.1 11.1 0 0 1 5.8 0c2.22-1.5 3.19-1.19 3.19-1.19.62 1.59.23 2.77.11 3.06.74.82 1.18 1.86 1.18 3.12 0 4.43-2.7 5.4-5.27 5.69.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>`;
  }
  if (source.includes('youtube')) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23 12.01s0-3.02-.39-4.48a3.2 3.2 0 0 0-2.25-2.26C18.9 4.88 12 4.88 12 4.88s-6.9 0-8.36.39A3.2 3.2 0 0 0 1.39 7.53C1 8.99 1 12.01 1 12.01s0 3.02.39 4.48a3.2 3.2 0 0 0 2.25 2.26c1.46.39 8.36.39 8.36.39s6.9 0 8.36-.39a3.2 3.2 0 0 0 2.25-2.26c.39-1.46.39-4.48.39-4.48zm-13.2 3.73V8.28l6.23 3.73-6.23 3.73z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l2.4 7.6H22l-6.2 4.6 2.4 7.8-6.2-4.5-6.2 4.5 2.4-7.8L2 9.6h7.6L12 2z"/></svg>`;
}

function renderCard(item) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const score = item.score ? `<span class="tag-chip tag-chip-score">score ${escapeHtml(item.score)}</span>` : '';
    const source = sourceLabel(item);
    const icon = sourceIcon(item);
    const thumb = item.thumbnail
        ? `<div class="card-thumb card-thumb-${escapeHtml(item.type || 'item')}"><img src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.title || source)}" loading="lazy" /></div>`
        : '';
    return `
        <article class="card card-type-${escapeHtml(item.type || 'item')}">
            <div class="card-link" data-url="${escapeHtml(item.url || '#')}" data-type="${escapeHtml(item.type || 'item')}" data-title="${escapeHtml(item.title || 'Untitled')}" data-source="${escapeHtml(source)}">
                ${thumb}
                <div class="card-main">
                    <div class="card-header">
                        <div class="card-title-wrap">
                            <div class="card-title">${escapeHtml(item.title || 'Untitled')}</div>
                            <div class="card-meta-row">
                                <button class="card-channel-btn card-channel-btn-${escapeHtml(item.type || 'item')}" data-source="${escapeHtml(source)}" title="Filter by source">
                                    <span class="source-icon" aria-hidden="true">${icon}</span>
                                    <span>${escapeHtml(source)}</span>
                                </button>
                                <span class="card-meta-sep">•</span>
                                <span class="card-date">${escapeHtml(formatRelativeDate(item.published))}</span>
                                <span class="card-meta-sep">•</span>
                                <span class="card-date">${escapeHtml(authorLabel(item))}</span>
                            </div>
                        </div>
                    </div>
                    <div class="summary-content expanded card-summary-block">
                        <div class="card-summary-text">${escapeHtml(item.summary || '')}</div>
                        ${item.why_it_matters ? `<div class="card-why"><strong>Why it matters:</strong> ${escapeHtml(item.why_it_matters)}</div>` : ''}
                        ${metricHtml(item.metrics)}
                    </div>
                    <div class="card-tags card-tags-bottom">
                        ${score}
                        ${tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
                    </div>
                </div>
            </div>
        </article>
    `;
}

function emptyStateHTML(message = 'No items yet') {
  return `<div class="empty-state"><div class="empty-title">${escapeHtml(message)}</div><div class="empty-sub">Add feed items to <code>data/ai-feed.json</code> and refresh.</div></div>`;
}

function noResultsHTML() {
  return `<div class="empty-state"><div class="empty-title">No matching items</div><div class="empty-sub">Try a different search or tag filter.</div></div>`;
}

function updateCount() {
    const el = document.getElementById('video-count');
    const filtered = getFilteredItems();
    el.textContent = `${filtered.length} items`;
}

function getYoutubeVideoId(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '');
        if (host === 'youtu.be') {
            return parsed.pathname.split('/').filter(Boolean)[0] || null;
        }
        if (host.endsWith('youtube.com')) {
            if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
            const parts = parsed.pathname.split('/').filter(Boolean);
            const marker = parts.findIndex((part) => ['embed', 'shorts', 'live', 'v'].includes(part));
            if (marker !== -1 && parts[marker + 1]) return parts[marker + 1];
        }
        return null;
    } catch {
        return null;
    }
}

function openLightbox(url, type, title) {
    const lightbox = document.getElementById('lightbox');
    const lightboxContent = lightbox.querySelector('.lightbox-content');
    const lightboxTitle = document.getElementById('lightbox-title');
    
    // Reset content
    lightboxContent.innerHTML = '';
    lightboxTitle.textContent = '';
    
    // Add close button
    const closeButton = document.createElement('div');
    closeButton.className = 'lightbox-close';
    closeButton.innerHTML = '&times;';
    closeButton.onclick = closeLightbox;
    lightboxContent.appendChild(closeButton);
    
    // Add title
    lightboxTitle.textContent = title;
    lightboxContent.appendChild(lightboxTitle);
    
    // Add content based on type
    if (type === 'youtube') {
        const videoId = getYoutubeVideoId(url);
        
        if (videoId) {
            // Create container for video and controls
            const videoWrapper = document.createElement('div');
            videoWrapper.style.position = 'relative';
            videoWrapper.style.width = '100%';
            videoWrapper.style.height = '100%';
            
            const iframe = document.createElement('iframe');
            iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
            iframe.allowFullscreen = true;
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            
            videoWrapper.appendChild(iframe);
            lightboxContent.appendChild(videoWrapper);
            
            // Add controls below the video
            const controlsContainer = document.createElement('div');
            controlsContainer.className = 'lightbox-controls';
            controlsContainer.style.marginTop = '16px';
            controlsContainer.style.display = 'flex';
            controlsContainer.style.gap = '8px';
            controlsContainer.style.justifyContent = 'center';
            controlsContainer.style.flexWrap = 'wrap';
            
            const speeds = [0.5, 1, 1.5, 2];
            speeds.forEach(speed => {
                const btn = document.createElement('button');
                btn.className = 'speed-btn';
                btn.textContent = `${speed}x`;
                btn.onclick = () => {
                    // Send message to YouTube iframe to change playback rate
                    iframe.contentWindow.postMessage('{"event":"command","func":"setPlaybackRate","args":[' + speed + ']}', '*');
                };
                controlsContainer.appendChild(btn);
            });
            
            lightboxContent.appendChild(controlsContainer);
            
            // Store reference to iframe for cleanup
            lightbox.currentIframe = iframe;
        }
    } else if (type === 'github') {
        // For GitHub, we'll show the raw content or use a service like rawgit
        // For simplicity, we'll just link to the GitHub page in an iframe
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.allowFullscreen = true;
        iframe.style.width = '100%';
        iframe.style.height = 'calc(100% - 48px)'; // Account for controls
        iframe.style.border = 'none';
        lightboxContent.appendChild(iframe);
        
        // Add simple close instruction for GitHub
        const instructions = document.createElement('div');
        instructions.style.position = 'absolute';
        instructions.style.top = '16px';
        instructions.style.left = '16px';
        instructions.style.background = 'rgba(0,0,0,0.7)';
        instructions.style.color = 'white';
        instructions.style.padding = '8px 12px';
        instructions.style.borderRadius = '4px';
        instructions.style.fontSize = '14px';
        instructions.textContent = 'Click anywhere outside to close';
        lightboxContent.appendChild(instructions);
    }
    
    // Show lightbox
    lightbox.classList.add('active');
    
    // Add click outside to close for GitHub lightbox
    if (type === 'github') {
        lightbox.onclick = (e) => {
            if (e.target === lightbox) {
                closeLightbox();
            }
        };
    } else {
        lightbox.onclick = null;
    }
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('active');
    // Clear content when closing
    const lightboxContent = lightbox.querySelector('.lightbox-content');
    lightboxContent.innerHTML = '';
}

async function fetchItems() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allItems = await res.json();
    allItems.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
    buildTagFilters();
    renderChannelFilterBar();
    renderFeed();
    updateCount();
  } catch (err) {
    document.getElementById('feed').innerHTML = emptyStateHTML(`Failed to load feed: ${err.message}`);
  } finally {
    btn.classList.remove('spinning');
  }
}

function renderFeed() {
  const feed = document.getElementById('feed');
  if (!allItems.length) {
    feed.innerHTML = emptyStateHTML();
    return;
  }

  const filtered = getFilteredItems();
  if (!filtered.length) {
    feed.innerHTML = noResultsHTML();
    return;
  }

  const groups = groupByDate(filtered);
  const order = ['Today', 'Yesterday', 'This Week', 'Older'];
  let html = '';
  order.forEach((label) => {
    const items = groups[label];
    if (!items.length) return;
    html += `<div class="date-group"><div class="date-group-label">${label} <span style="font-weight:400;opacity:0.5">${items.length}</span></div>`;
    items.forEach((item) => {
      html += renderCard(item);
    });
    html += '</div>';
  });
  feed.innerHTML = html;

  feed.querySelectorAll('.card-channel-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSourceFilter(btn.dataset.source);
    });
  });
}

function onSearch(e) {
  const val = e.target.value;
  document.getElementById('search-clear').style.display = val ? 'flex' : 'none';
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = val.trim().toLowerCase();
    renderFeed();
    updateCount();
  }, 150);
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  searchQuery = '';
  renderFeed();
  updateCount();
}

initTheme();
setInterval(() => {
    if (manualTheme === null) setTimeBasedTheme();
}, 60000);

function initApp() {
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const refreshBtn = document.getElementById('refresh-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const clearChannelFilter = document.getElementById('clear-channel-filter');
    const feed = document.getElementById('feed');

    if (!searchInput || !searchClear || !refreshBtn || !themeToggle || !clearChannelFilter || !feed) {
        return;
    }

    searchInput.addEventListener('input', onSearch);
    searchClear.addEventListener('click', clearSearch);
    refreshBtn.addEventListener('click', fetchItems);
    themeToggle.addEventListener('click', toggleTheme);
    clearChannelFilter.addEventListener('click', () => {
        activeChannelFilter = null;
        renderChannelFilterBar();
        renderFeed();
        updateCount();
    });

    document.addEventListener('click', (event) => {
        const cardLink = event.target.closest('.card-link');
        if (cardLink) {
            event.preventDefault();
            const url = cardLink.getAttribute('data-url');
            const type = cardLink.getAttribute('data-type');
            const title = cardLink.getAttribute('data-title');
            openLightbox(url, type, title);
        }
    });

    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('lightbox-close')) {
            closeLightbox();
        }
    });

    fetchItems();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
    initApp();
}
