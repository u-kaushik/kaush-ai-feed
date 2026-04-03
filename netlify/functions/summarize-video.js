/**
 * summarize-video — Netlify Function
 * 
 * Uses OpenRouter (free tier) to generate video summaries on-the-fly.
 * Called when user clicks "Read more" on a video card.
 * 
 * POST /.netlify/functions/summarize-video
 * Body: { url, title, channel }
 */

const OPENROUTER_API_KEY = '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';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

exports.handler = async function (event) {
  // Add CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { url, title, channel } = body;
  if (!url || !title) {
    return { statusCode: 400, headers, body: 'Missing url or title' };
  }

  const prompt = `You are a helpful assistant that summarizes YouTube videos.
Given the video title and channel, provide a brief summary in 5-7 bullet points.
Each bullet should capture a key point or insight from the video.
Keep each bullet concise (under 20 words).

Video: ${title}
Channel: ${channel || 'Unknown'}
URL: ${url}

Format as bullet points, one per line, starting with a dash or bullet character.`;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kaush-ai-feed.netlify.app',
        'X-Title': 'Kaush AI Feed',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.1-8b-instruct',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'LLM API failed', details: errorText }),
        headers,
      };
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content || 'No summary generated';

    return {
      statusCode: 200,
      body: JSON.stringify({ summary }),
      headers,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
      headers,
    };
  }
};