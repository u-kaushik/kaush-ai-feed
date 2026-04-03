// Netlify function for AI summarization using Groq
// The API key is stored securely in Netlify env vars, not in client code

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

exports.handler = async function(event) {
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

  if (!GROQ_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: 'Invalid JSON' };
  }

  const { videoUrl, videoTitle, videoChannel } = body;
  if (!videoTitle) {
    return { statusCode: 400, headers, body: 'Missing videoTitle' };
  }

  const prompt = `You are a helpful assistant that summarizes YouTube videos.
Given the video title and channel, provide a brief summary in 5-7 bullet points.
Keep each bullet concise and informative.

Video: ${videoTitle}
Channel: ${videoChannel || 'Unknown'}
URL: ${videoUrl || ''}

Format as bullet points, one per line.`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, headers, body: err };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ summary: content || '' })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};