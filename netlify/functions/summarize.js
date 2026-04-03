// Netlify function for AI summarization using Groq + YouTube Data API
// API keys MUST be set as Netlify environment variables - never hardcoded

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3/videos';

// Helper to extract video ID from various YouTube URL formats
function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Fetch video details from YouTube Data API
async function fetchYouTubeVideoDetails(videoId) {
  if (!videoId || !YOUTUBE_API_KEY) return null;
  
  try {
    const url = `${YOUTUBE_API_URL}?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    const snippet = data.items?.[0]?.snippet;
    if (!snippet) return null;
    
    return {
      title: snippet.title,
      description: snippet.description,
      channelTitle: snippet.channelTitle,
    };
  } catch (e) {
    console.warn('YouTube API error:', e.message);
    return null;
  }
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Debug: log env var status
  console.log('GROQ_API_KEY present:', !!GROQ_API_KEY);
  console.log('YOUTUBE_API_KEY present:', !!YOUTUBE_API_KEY);
  console.log('YOUTUBE_API_KEY value:', YOUTUBE_API_KEY ? YOUTUBE_API_KEY.substring(0, 10) + '...' : 'undefined');

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

  const { description: existingDescription } = body;
  
  // Try to fetch video description from YouTube API if we have a URL
  let description = existingDescription;
  let descriptionSource = 'client description';
  
  // Check if description is missing/empty, then try YouTube API
  if (!description || description.length < 50) {
    if (videoUrl) {
      const videoId = extractVideoId(videoUrl);
      if (videoId) {
        console.log('Fetching from YouTube API for:', videoId);
        const ytDetails = await fetchYouTubeVideoDetails(videoId);
        if (ytDetails && ytDetails.description && ytDetails.description.length > 50) {
          description = ytDetails.description;
          descriptionSource = 'YouTube API';
          console.log('Got description from YouTube API, length:', description.length);
        } else {
          console.log('YouTube API returned no description, ytDetails:', ytDetails);
        }
      }
    }
  }
  
  // Build prompt using description if available, otherwise title
  let prompt;
  if (description && description.length > 50) {
    console.log('Using description for summary, source:', descriptionSource);
    prompt = `You are a helpful assistant that summarizes YouTube videos.
Given the video description below, extract the key points and create a brief summary in 5-7 bullet points.
Remove any promotional links, timestamps, or irrelevant content. Keep each bullet concise and informative.

Video Title: ${videoTitle}
Channel: ${videoChannel || 'Unknown'}
Video Description:
${description}

Format as bullet points, one per line. At the end, add a note: "[Summary from ${descriptionSource}]"`;
  } else {
    console.log('No description available, falling back to title-based summary. Description length:', description?.length || 0);
    prompt = `You are a helpful assistant that summarizes YouTube videos.
Based on the video title and channel name, provide a brief summary in 5-7 bullet points.
Keep each bullet concise and informative.

Video Title: ${videoTitle}
Channel: ${videoChannel || 'Unknown'}
Video URL: ${videoUrl || ''}

Format as bullet points, one per line. At the end, add a note: "[Summary based on video title]"`;
  }

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