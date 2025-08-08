const router = require('express').Router();
const axios = require('axios');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;


const convertDurationToSeconds = (duration) => {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return 0; 
  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0; 
  const seconds = match[3] ? parseInt(match[3]) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

const getSearchResults = async (q) => {
  try {
    const ytRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q,
        type: 'song',
        maxResults: 15,
        key: YOUTUBE_API_KEY,
      }
      // No custom headers
    });
  
    const results = ytRes.data.items.map(item => ({
      id: item.id.videoId,
    }));
  
    return results;
  } catch (error) {
    console.log('YouTube API error:', error?.response?.data || error);
    throw error; // Re-throw to handle in the route
  }
}

const getVideoDetails = async (results) => {
  if (results.length === 0) return [];

  const videoIds = results.map(r => r.id).join(',');

  const ytRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      part: 'snippet,contentDetails',
      id: videoIds,
      key: YOUTUBE_API_KEY,
    }
  });

  return ytRes.data.items.map(item => ({
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnail: item.snippet.thumbnails.high.url,
    duration: convertDurationToSeconds(item.contentDetails.duration),
  }));
}

router.get('/', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing query' });

  try {
    if (!YOUTUBE_API_KEY) {
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }
    // Remove custom User-Agent header and videoCategoryId to avoid 403 errors.
    // Use only required headers and parameters.
    const searchRes = await getSearchResults(q);

    const results = await getVideoDetails(searchRes);

    res.json({ results });
  } catch (err) {
    console.error(err?.response?.data || err);
    // Provide more specific error message if available
    if (err.response && err.response.status === 403) {
      return res.status(403).json({ error: 'YouTube API access forbidden (403). Check your API key and quota.' });
    }
    res.status(500).json({ error: 'YouTube API error' });
  }
});

module.exports = router;