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
  if (item.type === 'youtube' && item.author && item.author !== 'YouTube') return item.author;
  if (item.type === 'youtube' && item.channel && item.channel !== 'YouTube') return item.channel;
  return item.author || item.channel || 'Unknown';
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
    const thumbnail = item.thumbnail || (item.type === 'youtube' && item.url ? `https://i.ytimg.com/vi/${escapeHtml(getYoutubeVideoId(item.url) || '')}/hqdefault.jpg` : '');
    const sourceChip =
        item.type === 'youtube'
            ? ''
            : `<button class="card-channel-btn card-channel-btn-${escapeHtml(item.type || 'item')}" data-source="${escapeHtml(source)}" title="Filter by source">
                  <span class="source-icon" aria-hidden="true">${icon}</span>
                  <span>${escapeHtml(source)}</span>
               </button>`;
    const thumb = thumbnail
        ? `<div class="card-thumb card-thumb-${escapeHtml(item.type || 'item')}"><img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(item.title || source)}" loading="lazy" /></div>`
        : '';
    return `
        <article class="card card-type-${escapeHtml(item.type || 'item')}">
            <div class="card-link" data-id="${escapeHtml(item.id || '')}" data-url="${escapeHtml(item.url || '#')}" data-type="${escapeHtml(item.type || 'item')}" data-title="${escapeHtml(item.title || 'Untitled')}" data-source="${escapeHtml(source)}">
                ${thumb}
                <div class="card-main">
                    <div class="card-header">
                        <div class="card-title-wrap">
                            <div class="card-title">${escapeHtml(item.title || 'Untitled')}</div>
                            <div class="card-meta-row">
                                ${sourceChip}
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

function getItemById(itemId) {
    return allItems.find((item) => item.id === itemId) || null;
}

function getYoutubePlaybackRate() {
    const stored = Number(localStorage.getItem('yt_playback_rate'));
    return Number.isFinite(stored) && stored > 0 ? stored : 2;
}

function setYoutubePlaybackRate(rate) {
    const lightbox = document.getElementById('lightbox');
    const iframe = lightbox.currentIframe;
    const nextRate = Number(rate) || 2;

    localStorage.setItem('yt_playback_rate', String(nextRate));
    lightbox.currentPlaybackRate = nextRate;

    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [nextRate] }),
            '*',
        );
    }
}

function stepYoutubePlaybackRate() {
    const lightbox = document.getElementById('lightbox');
    const currentRate = Number(lightbox.currentPlaybackRate || getYoutubePlaybackRate() || 1);
    const steppedRate = Math.min(3, Math.round((currentRate + 0.5) * 2) / 2);
    setYoutubePlaybackRate(steppedRate);
}

function renderYoutubeLightbox(lightboxContent, item) {
    const lightbox = document.getElementById('lightbox');
    const videoId = getYoutubeVideoId(item.url || '');
    if (!videoId) return;
    const embedOrigin = window.location.origin ? `&origin=${encodeURIComponent(window.location.origin)}` : '';

    const isShort = (item.url || '').includes('/shorts/') || (item.url || '').includes('youtu.be/');

    lightboxContent.className = 'lightbox-content lightbox-content--youtube';
    lightboxContent.innerHTML = `
      <div class="lightbox-close" aria-label="Close lightbox">&times;</div>
      <div class="youtube-lightbox-player-wrap${isShort ? ' is-short' : ''}">
        <iframe
          src="https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1&controls=0&rel=0&modestbranding=1${embedOrigin}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>
    `;

    const iframe = lightboxContent.querySelector('iframe');
    iframe.onload = () => {
        if (lightbox.seekToTime !== null && lightbox.seekToTime > 0) {
            setTimeout(() => {
                iframe.contentWindow.postMessage(
                    JSON.stringify({ event: 'command', func: 'seekTo', args: [lightbox.seekToTime, true] }),
                    '*',
                );
            }, 1000);
        }
        setTimeout(() => setYoutubePlaybackRate(Number(lightbox.currentPlaybackRate || getYoutubePlaybackRate() || 1)), 250);
    };

    lightbox.currentIframe = iframe;
    lightbox.currentVideoId = videoId;
    lightbox.currentPlaybackRate = getYoutubePlaybackRate();
    const savedTime = localStorage.getItem(`yt_${videoId}`);
    lightbox.seekToTime = savedTime ? parseFloat(savedTime) : null;
}

function renderGithubLightbox(lightboxContent, item) {
    lightboxContent.className = 'lightbox-content lightbox-content--github';
    lightboxContent.innerHTML = `
      <div class="lightbox-close" aria-label="Close lightbox">&times;</div>
      <div class="lightbox-shell github-lightbox">
        <div class="github-lightbox-head">
          <div class="github-lightbox-kicker">GitHub summary</div>
          <h2 class="github-lightbox-title">${escapeHtml(item.title || 'Untitled')}</h2>
          <div class="github-lightbox-meta">
            <span>${escapeHtml(authorLabel(item))}</span>
            <span>•</span>
            <span>${escapeHtml(formatRelativeDate(item.published))}</span>
            ${item.metrics?.language ? `<span>•</span><span>${escapeHtml(item.metrics.language)}</span>` : ''}
          </div>
        </div>
        <div class="github-lightbox-summary">
          <p>${escapeHtml(item.summary || 'No summary yet.')}</p>
          ${item.why_it_matters ? `<p class=\"github-lightbox-why\"><strong>Why it matters:</strong> ${escapeHtml(item.why_it_matters)}</p>` : ''}
          ${metricHtml(item.metrics)}
        </div>
        <div class="github-lightbox-body">
          <div class="github-lightbox-tags">${(Array.isArray(item.tags) && item.tags.length ? item.tags : ['GitHub']).map((tag) => `<span>${escapeHtml(tag)}</span>`).join(' ')}</div>
          <p class="github-lightbox-empty">Open the repo for a full breakdown.</p>
        </div>
        <div class="github-lightbox-actions">
          <a class="github-lightbox-btn" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noreferrer">Open repo ↗</a>
        </div>
      </div>
    `;
}

function openLightbox(item) {
    if (!item) return;
    const lightbox = document.getElementById('lightbox');
    const lightboxContent = lightbox.querySelector('.lightbox-content');

    lightbox.classList.add('active');
    lightbox.onclick = (event) => {
        if (event.target === lightbox) closeLightbox();
    };

    lightboxContent.className = 'lightbox-content';
    lightboxContent.innerHTML = '';

    if (item.type === 'youtube') {
        renderYoutubeLightbox(lightboxContent, item);
        return;
    }

    if (item.type === 'github') {
        renderGithubLightbox(lightboxContent, item);
        const githubCloseButton = lightboxContent.querySelector('.lightbox-close');
        if (githubCloseButton) githubCloseButton.onclick = closeLightbox;
        return;
    }

    window.open(item.url || '#', '_blank', 'noopener,noreferrer');
    closeLightbox();
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('active');
    // Clear content when closing
    const lightboxContent = lightbox.querySelector('.lightbox-content');
    if (lightbox.currentVideoId && Number.isFinite(lightbox.lastKnownTime)) {
        localStorage.setItem(`yt_${lightbox.currentVideoId}`, String(lightbox.lastKnownTime));
    }
    lightboxContent.innerHTML = '';
    // Reset lightbox state
    lightbox.currentIframe = null;
    lightbox.currentVideoId = null;
    lightbox.seekToTime = null;
    lightbox.currentPlaybackRate = null;
    lightbox.lastKnownTime = null;
}

async function fetchItems() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  try {
    const url = `${FEED_URL}?v=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
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
            const item = getItemById(cardLink.getAttribute('data-id')) || {
                id: cardLink.getAttribute('data-id') || '',
                url: cardLink.getAttribute('data-url') || '#',
                type: cardLink.getAttribute('data-type') || 'item',
                title: cardLink.getAttribute('data-title') || 'Untitled',
                source: cardLink.getAttribute('data-source') || 'Item',
            };
            openLightbox(item);
        }
    });

    document.addEventListener('click', (event) => {
         if (event.target.classList.contains('lightbox-close')) {
             closeLightbox();
         }
     });

    document.addEventListener('keydown', (event) => {
        if (!document.getElementById('lightbox').classList.contains('active')) return;
        const key = event.key.toLowerCase();
        if (key === 'd') {
            event.preventDefault();
            stepYoutubePlaybackRate();
        }
    });
     
     // Add event listener for YouTube API messages (for getting current time)
     window.addEventListener('message', (event) => {
         // Only accept messages from YouTube iframes
         if (event.origin !== 'https://www.youtube.com') return;
         
         const data = event.data;
         // Handle YouTube API responses
         if (data && typeof data === 'object' && data.event === 'infoDelivery') {
             // Save current playback time when we get it
             if (data.info && data.info.currentTime) {
                 const currentTime = data.info.currentTime;
                 const lightbox = document.getElementById('lightbox');
                 lightbox.lastKnownTime = currentTime;
                 // Save to localStorage if we have a video ID
                 if (lightbox.currentVideoId) {
                     localStorage.setItem(`yt_${lightbox.currentVideoId}`, currentTime);
                 }
             }
         }
     });

    window.addEventListener('beforeunload', () => {
        const lightbox = document.getElementById('lightbox');
        if (lightbox.currentVideoId && Number.isFinite(lightbox.lastKnownTime)) {
            localStorage.setItem(`yt_${lightbox.currentVideoId}`, String(lightbox.lastKnownTime));
        }
    });

    fetchItems();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
    initApp();
}
