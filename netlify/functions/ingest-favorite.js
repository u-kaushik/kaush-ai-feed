/**
 * ingest-favorite — Netlify Function
 *
 * Called when a user favorites a video in the AI feed.
 * Inserts the video into the Supabase knowledge table so it
 * appears in the morning YouTube briefing.
 *
 * POST /.netlify/functions/ingest-favorite
 * Body: { url, title, channel, tags, thumbnail, published }
 */

const SUPABASE_URL = 'https://thtcmxdcchxxbrsbkjar.supabase.co';
const SUPABASE_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRodGNteGRjY2h4eGJyc2JramFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTM0NTkzNSwiZXhwIjoyMDg2OTIxOTM1fQ.qqu06e6TzOE4je51biPDOZs6TrBoxvOgbUKvyHhCb08';

const HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { url, title, channel, tags, thumbnail, published } = body;

  if (!url || !/youtube\.com|youtu\.be/.test(url)) {
    return { statusCode: 400, body: 'Invalid YouTube URL' };
  }

  // Check if already ingested
  const checkUrl = new URL(`${SUPABASE_URL}/rest/v1/knowledge`);
  checkUrl.searchParams.set('source_url', `eq.${url}`);
  checkUrl.searchParams.set('select', 'id');
  checkUrl.searchParams.set('limit', '1');

  try {
    const checkRes = await fetch(checkUrl.toString(), { headers: HEADERS });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) {
        return {
          statusCode: 200,
          body: JSON.stringify({ ok: true, status: 'already_exists' }),
          headers: { 'Content-Type': 'application/json' },
        };
      }
    }
  } catch {
    // If check fails, proceed with insert (idempotent via source_url uniqueness)
  }

  const record = {
    title: title || 'Untitled',
    source_url: url,
    source_type: 'youtube',
    content: `${title || 'Untitled'}\n\nChannel: ${channel || 'Unknown'}\n\nFavorited from Kaush AI Feed. Full transcript not available — video was manually curated.`,
    chunk_index: 0,
    tags: Array.isArray(tags) ? tags : [],
    ingested_by: 'kaush-ai-feed',
    owner: 'jarvis',
    confidence: 'low',
    metadata: {
      channel: channel || null,
      thumbnail: thumbnail || null,
      published: published || null,
      source: 'favorite',
    },
  };

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/knowledge`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(record),
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, status: 'ingested' }),
    headers: { 'Content-Type': 'application/json' },
  };
};
