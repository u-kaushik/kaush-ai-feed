import { execFile as execFileCb } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const feedPath = path.join(dataDir, 'ai-feed.json');
const ytFeedPath = path.join(dataDir, 'yt-feed.json');
const stateDir = path.join(root, '.state');
const statePath = path.join(stateDir, 'last-run.json');

const GITHUB_WINDOW_DAYS = Number(process.env.GITHUB_WINDOW_DAYS || 7);
const YOUTUBE_WINDOW_DAYS = Number(process.env.YOUTUBE_WINDOW_DAYS || 14);
const YOUTUBE_MAX_RESULTS = Math.min(20, Number(process.env.YOUTUBE_MAX_RESULTS || 12));
const YOUTUBE_SEARCH_QUERY = process.env.YOUTUBE_QUERY || process.env.YOUTUBE_SEARCH || 'AI OR "machine learning" OR developer tools';
const YOUTUBE_API_KEY =
  process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY;
const YOUTUBE_FEEDS =
  process.env.YOUTUBE_FEEDS ||
  process.env.YOUTUBE_CHANNEL_IDS ||
  process.env.YT_CHANNEL_IDS ||
  '';
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_SEARCH_ENDPOINT = `${YOUTUBE_API_URL}/search`;

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(0, Number(days) || 0));
  return date.toISOString().slice(0, 10);
}

function toRfc3339(date) {
  return new Date(date).toISOString();
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function normalizeYoutubeId(rawId) {
  if (rawId == null) return null;
  if (typeof rawId === 'string' || typeof rawId === 'number') return String(rawId);
  if (typeof rawId === 'object' && rawId.videoId) return String(rawId.videoId);
  return null;
}

function buildGithubQuery() {
  if (process.env.GITHUB_QUERY && process.env.GITHUB_QUERY.trim()) {
    return process.env.GITHUB_QUERY.trim();
  }

  const since = isoDateDaysAgo(GITHUB_WINDOW_DAYS);
  return [
    `created:>=${since}`,
    'stars:>50',
    'topic:ai',
  ].join(' ');
}

function nowIso() {
  return new Date().toISOString();
}

async function resolveGithubCli() {
  const envPath = process.env.GH_PATH || process.env.GITHUB_CLI_PATH;
  if (envPath) return envPath;

  const home = os.homedir();
  const candidates = [
    path.join(home, 'bin', 'gh'),
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    '/usr/bin/gh',
    'gh',
  ];

  for (const candidate of candidates) {
    if (candidate === 'gh') return 'gh';
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // ignore
    }
  }

  return 'gh';
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function inferGithubTags(repo) {
  const topicTags = Array.isArray(repo.topics) ? repo.topics.slice(0, 4) : [];
  const tags = new Set(topicTags.map((tag) => String(tag).replace(/-/g, ' ')));
  tags.add('GitHub');
  return [...tags].slice(0, 5);
}

function summarizeGithub(repo) {
  const desc = String(repo.description || '').trim();
  if (desc) return desc;
  return 'Fast-rising GitHub repo worth checking in the daily AI/operator workflow sweep.';
}

function whyGithub(repo) {
  const topics = Array.isArray(repo.topics) ? repo.topics : [];
  if (topics.some((t) => ['agent', 'agents', 'automation', 'browser-automation'].includes(t))) {
    return 'Strong fit for operator leverage, agent workflows, and business automation ideas.';
  }
  if (topics.some((t) => ['ai', 'llm', 'rag', 'memory'].includes(t))) {
    return 'Relevant to Jarvis, AI workflows, and product ideas worth monitoring closely.';
  }
  return 'Potentially useful signal for the morning AI digest and fast-moving product patterns.';
}

function scoreGithub(repo) {
  const stars = Number(repo.stargazers_count || 0);
  const forks = Number(repo.forks_count || 0);
  const recentPushBoost = repo.pushed_at ? 8 : 0;
  return Math.min(99, Math.round(stars / 150 + forks / 40 + recentPushBoost + 55));
}

async function fetchGithubRepos() {
  const gh = await resolveGithubCli();
  const query = buildGithubQuery();
  try {
    const { stdout } = await execFile(
      gh,
      [
        'api',
        '/search/repositories',
        '-X',
        'GET',
        '-f',
        `q=${query}`,
        '-f',
        'sort=stars',
        '-f',
        'order=desc',
        '-f',
        'per_page=12',
      ],
      { cwd: root, maxBuffer: 1024 * 1024 * 4 },
    );
    const json = safeJsonParse(stdout, { items: [] });
    return Array.isArray(json.items) ? json.items : [];
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
    const hint = code === 'ENOENT'
      ? `GitHub CLI not found (${gh})`
      : 'GitHub ingestion failed';

    console.warn(
      `ai-digest: ${hint}; continuing without GitHub items. (${error instanceof Error ? error.message : String(error)})`,
    );
    return [];
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

function toGithubItem(repo) {
  return {
    id: `github-${slug(repo.full_name || repo.html_url)}`,
    type: 'github',
    source: 'GitHub',
    title: repo.full_name,
    url: repo.html_url,
    author: repo.owner?.login || 'GitHub',
    published: repo.created_at || repo.updated_at || nowIso(),
    tags: inferGithubTags(repo),
    summary: summarizeGithub(repo),
    why_it_matters: whyGithub(repo),
    score: scoreGithub(repo),
    metrics: {
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language || undefined,
    },
    updated_at: nowIso(),
  };
}

function scoreYoutube(item) {
  const title = String(item.title || '').toLowerCase();
  let base = 64;
  if (title.includes('claude code')) base += 10;
  if (title.includes('open source') || title.includes('opensource')) base += 6;
  if (title.includes('agent') || title.includes('automation')) base += 6;
  return Math.min(88, base);
}

function toYoutubeItem(video) {
  return {
    id: `youtube-${slug(video.id || video.url)}`,
    type: 'youtube',
    source: 'YouTube',
    title: video.title,
    url: video.url,
    author: video.channel || 'YouTube',
    published: video.published || nowIso(),
    tags: Array.isArray(video.tags) ? video.tags.slice(0, 5) : ['YouTube'],
    summary: video.description?.trim() || 'Selected AI/dev YouTube signal from the existing watched-channel feed.',
    why_it_matters:
      'Useful for spotting practical tools, coding workflow shifts, and adjacent AI opportunities without scanning YouTube manually.',
    thumbnail: video.thumbnail,
    score: scoreYoutube(video),
    updated_at: nowIso(),
  };
}

function normalizeYoutubePayload(raw) {
  if (!raw) return null;
  const snippet = raw.snippet || {};
  const id = normalizeYoutubeId(raw.id) || normalizeYoutubeId(raw.videoId) || raw.videoId || raw.id;
  const title = snippet.title || raw.title;

  if (!id || !title) return null;

  const thumb = snippet.thumbnails || {};
  const thumbnail =
    thumb.maxres?.url ||
    thumb.high?.url ||
    thumb.medium?.url ||
    thumb.default?.url ||
    raw.thumbnail ||
    '';

  return {
    id: String(id),
    title: String(title),
    url:
      raw.url ||
      raw.videoUrl ||
      `https://www.youtube.com/watch?v=${encodeURIComponent(String(id))}`,
    channel: snippet.channelTitle || raw.channel || 'YouTube',
    channelUrl: snippet.channelId
      ? `https://www.youtube.com/channel/${snippet.channelId}`
      : raw.channelId
      ? `https://www.youtube.com/channel/${raw.channelId}`
      : raw.channelUrl,
    published: snippet.publishedAt || raw.published || raw.publishedAt || nowIso(),
    thumbnail,
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 5) : ['YouTube'],
    description: raw.description || snippet.description || '',
  };
}

function parseFeedIds(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .replace(/[\n,;]+/g, ',')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function extractXmlField(html, regex, fallback) {
  const match = html.match(regex);
  return match ? decodeXmlText(match[1] || '') : fallback;
}

async function fetchYoutubeBySearch() {
  if (!YOUTUBE_API_KEY) {
    throw new Error('YOUTUBE_API_KEY is not set');
  }

  const since = toRfc3339(new Date(Date.now() - Math.max(0, YOUTUBE_WINDOW_DAYS) * 24 * 60 * 60 * 1000));
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    order: 'date',
    maxResults: String(Math.max(1, YOUTUBE_MAX_RESULTS)),
    q: YOUTUBE_SEARCH_QUERY,
    key: YOUTUBE_API_KEY,
    publishedAfter: since,
  });

  const url = `${YOUTUBE_SEARCH_ENDPOINT}?${params.toString()}`;
  const { stdout } = await execFile('curl', ['-L', '--compressed', '--max-time', '20', url], {
    maxBuffer: 1024 * 1024 * 4,
  });
  const payload = safeJsonParse(stdout, { items: [] });
  return Array.isArray(payload.items) ? payload.items.map((item) => normalizeYoutubePayload(item)).filter(Boolean) : [];
}

async function fetchYoutubeByFeedUrls() {
  const channelIds = parseFeedIds(YOUTUBE_FEEDS);
  if (!channelIds.length) return [];

  const requests = channelIds.slice(0, 5).map(async (channelId) => {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    const { stdout } = await execFile('curl', ['-L', '--compressed', '--max-time', '20', rssUrl], {
      maxBuffer: 1024 * 1024 * 4,
    });

    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let entryMatch = entryRegex.exec(stdout);
    if (!entryMatch) return [];

    const entries = [];
    let remaining = Math.max(1, channelIds.length);
    while (entryMatch && entries.length < Math.ceil(YOUTUBE_MAX_RESULTS / remaining)) {
      const entry = entryMatch[1] || '';
      const id = extractXmlField(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/);
      const thumbnail = extractXmlField(entry, /<media:thumbnail[^>]*url="([^"]+)"/);
      const title = extractXmlField(entry, /<title>([^<]+)<\/title>/);
      const channelIdCaptured = extractXmlField(entry, /<yt:channelId>([^<]+)<\/yt:channelId>/);
      const published = extractXmlField(entry, /<published>([^<]+)<\/published>/);
      const channel = extractXmlField(entry, /<media:credit role="uploader"[^>]*>([^<]+)<\/media:credit>/, 'YouTube');

      entries.push(
        normalizeYoutubePayload({
          id,
          title,
          channelTitle: channel || channelIdCaptured || 'YouTube',
          channelId: channelIdCaptured,
          publishedAt: published,
          thumbnails: { default: { url: thumbnail } },
          description: '',
        }),
      );
      entryMatch = entryRegex.exec(stdout);
    }
    return entries.filter(Boolean);
  });

  const bucket = await Promise.all(requests);
  return bucket.flat().filter(Boolean);
}

async function fetchYoutubeFeed() {
  const fallbackVideos = await readJson(ytFeedPath, []);
  const localCandidates = Array.isArray(fallbackVideos) ? fallbackVideos : [];

  try {
    const fetched = await fetchYoutubeBySearch();
    if (fetched.length) {
      return fetched;
    }
  } catch (error) {
    // fall through to RSS feed / local snapshot below
  }

  if (YOUTUBE_FEEDS.trim()) {
    try {
      const channelVideos = await fetchYoutubeByFeedUrls();
      if (channelVideos.length) return channelVideos;
    } catch (error) {
      // continue fallback
    }
  }

  return localCandidates.map((video) => normalizeYoutubePayload(video)).filter(Boolean);
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  await mkdir(stateDir, { recursive: true });

  const [youtubeFeed, githubRepos] = await Promise.all([
    fetchYoutubeFeed(),
    fetchGithubRepos(),
  ]);

  const githubItems = githubRepos.map(toGithubItem);
  const youtubeItems = (Array.isArray(youtubeFeed) ? youtubeFeed : [])
    .map((video) => toYoutubeItem(video))
    .slice(0, 10);
  const merged = dedupeByUrl([...githubItems, ...youtubeItems])
    .sort((a, b) => {
      const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return new Date(b.published || 0) - new Date(a.published || 0);
    })
    .slice(0, 24);

  await writeFile(feedPath, JSON.stringify(merged, null, 2) + '\n');
  await writeFile(
    statePath,
    JSON.stringify(
      {
        lastRunAt: nowIso(),
        itemCount: merged.length,
        githubCount: githubItems.length,
        youtubeCount: youtubeItems.length,
        notes: [
          'GitHub items are fetched from GitHub search via gh auth.',
          'YouTube items are fetched from YouTube (API or channel RSS), with local yt-feed.json fallback.',
          'Morning email reads directly from data/ai-feed.json.',
        ],
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`ai-digest: updated ${merged.length} items (${githubItems.length} github, ${youtubeItems.length} youtube candidates)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
