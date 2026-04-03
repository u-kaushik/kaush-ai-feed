// Netlify function for AI summarization using Groq + YouTube Data API
// API keys MUST be set as Netlify environment variables - never hardcoded

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3/videos';

function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

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

// Clean description: remove links, timestamps, promotional fluff
function cleanDescription(description) {
  if (!description) return '';
  
  let text = description;
  
  // Remove URLs (http/https/bit.ly/etc)
  text = text.replace(/https?:\/\/\S+/g, '');
  text = text.replace(/bit\.ly\/\S+/g, '');
  
  // Remove timestamp lines (00:00 Intro, 05:32 - Title)
  text = text.replace(/^\d{1,2}:\d{2}\s*.+$/gm, '');
  text = text.replace(/^\d{1,2}:\d{2}\s*[-–—]\s*.+$/gm, '');
  
  // Remove common promotional lines
  text = text.replace(/^(subscribe|follow|like|comment|share).+$/gim, '');
  text = text.replace(/^(join|check out|visit|click).*(link|description|below).+$/gim, '');
  text = text.replace(/^(discord|twitter|instagram|tiktok|linkedin|facebook|telegram).+$/gim, '');
  
  // Remove emoji-only lines
  text = text.replace(/^[\s\p{Emoji}]+$/gmu, '');
  
  // Remove lines that are just section headers like "*** CORE Software ***"
  text = text.replace(/^\*{3}.+\*{3}$/gm, '');
  
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  
  return text;
}

// Extract key points from cleaned description
function extractKeyPoints(description, title) {
  if (!description) return null;
  
  // Split into meaningful chunks
  const paragraphs = description.split(/\n\n+/).filter(p => p.trim().length > 20);
  
  if (paragraphs.length === 0) return null;
  
  // If there's a single paragraph with actual content, use it directly
  if (paragraphs.length === 1) {
    const text = paragraphs[0].trim();
    if (text.length > 30) {
      return {
        type: 'description',
        content: text,
      };
    }
    return null;
  }
  
  // Multiple paragraphs - extract meaningful ones
  const points = [];
  const seen = new Set();
  
  for (const para of paragraphs) {
    const clean = para.trim();
    if (clean.length < 20) continue;
    if (clean.length > 500) continue; // Skip massive blocks
    
    const key = clean.substring(0, 50).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    
    points.push(clean);
  }
  
  if (points.length === 0) return null;
  
  return {
    type: 'bullets',
    content: points,
  };
}

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

  const { description: existingDescription } = body;
  
  // Try to fetch video description from YouTube API
  let description = existingDescription;
  
  if (!description || description.length < 50) {
    if (videoUrl) {
      const videoId = extractVideoId(videoUrl);
      if (videoId) {
        const ytDetails = await fetchYouTubeVideoDetails(videoId);
        if (ytDetails && ytDetails.description && ytDetails.description.length > 50) {
          description = ytDetails.description;
        }
      }
    }
  }
  
  // Clean the description
  const cleaned = cleanDescription(description);
  
  // Try to extract key points from the cleaned description
  const keyPoints = extractKeyPoints(cleaned, videoTitle);
  
  if (keyPoints) {
    if (keyPoints.type === 'description') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          summary: keyPoints.content,
          source: 'description',
        }),
      };
    } else if (keyPoints.type === 'bullets') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          summary: keyPoints.content.join('\n\n'),
          source: 'description',
        }),
      };
    }
  }
  
  // If no meaningful content in description, use AI to summarize from title
  // But be honest about it
  const prompt = `You are a helpful assistant. Given only a YouTube video title and channel name, provide 2-3 bullet points about what this video likely covers. Be honest that this is an inference from the title, not from the actual video content.

Video Title: ${videoTitle}
Channel: ${videoChannel || 'Unknown'}

Format:
- [First likely topic]
- [Second likely topic]
- [Third likely topic]

End with: "(Inferred from title only — no description available)"`;

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
        max_tokens: 200,
        temperature: 0.5
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
      body: JSON.stringify({ summary: content || '', source: 'title-inference' })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};