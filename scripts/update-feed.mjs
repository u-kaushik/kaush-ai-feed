import { execFile as execFileCb } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

const GITHUB_QUERY = [
  'created:>2026-04-01',
  'stars:>80',
  'topic:ai',
].join(' ');

function nowIso() {
  return new Date().toISOString();
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
  const { stdout } = await execFile(
    'gh',
    [
      'api',
      '/search/repositories',
      '-X',
      'GET',
      '-f',
      `q=${GITHUB_QUERY}`,
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
    readJson(ytFeedPath, []),
    fetchGithubRepos(),
  ]);

  const githubItems = githubRepos.map(toGithubItem);
  const youtubeItems = (Array.isArray(youtubeFeed) ? youtubeFeed : []).slice(0, 10).map(toYoutubeItem);
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
          'YouTube items are pulled from the local yt-feed.json source.',
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
