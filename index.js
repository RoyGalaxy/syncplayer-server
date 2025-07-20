const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://syncplayer-client.vercel.app"
  ],
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;



app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing query' });

  try {
    if (!YOUTUBE_API_KEY) {
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }
    // Remove custom User-Agent header and videoCategoryId to avoid 403 errors.
    // Use only required headers and parameters.
    const ytRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q,
        type: 'music',
        maxResults: 15,
        key: YOUTUBE_API_KEY,
      }
      // No custom headers
    });

    const results = ytRes.data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.high.url,
    }));

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

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://syncplayer-client.vercel.app"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
})

const { nanoid } = require('nanoid');
const rooms = {};

io.on('connection', (socket) => {
  // Create a new room
  socket.on('createRoom', (user, cb) => {
    const roomId = nanoid(6);
    rooms[roomId] = {
      queue: [],
      currentTrack: null,
      playback: { isPlaying: false, time: 0 },
      participants: {},
      history: []
    };
    cb(roomId);
  });

  // Join an existing room
  socket.on('joinRoom', ({ roomId, user }, cb) => {
    if (!rooms[roomId]) return cb({ error: 'Room not found' });
    socket.join(roomId);
    rooms[roomId].participants[socket.id] = { name: user, lastActive: Date.now() };
    cb({ room: rooms[roomId] });
    io.to(roomId).emit('participants', Object.values(rooms[roomId].participants));
  });

  // Play a track
  socket.on('play', ({ roomId, track, time, user }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].currentTrack = track;
    rooms[roomId].playback = { isPlaying: true, time };
    rooms[roomId].history.push({ track, user, timestamp: Date.now() });
    io.to(roomId).emit('play', { track, time, user });
  });

  // Pause playback
  socket.on('pause', ({ roomId, time }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].playback.isPlaying = false;
    rooms[roomId].playback.time = time;
    io.to(roomId).emit('pause', { time });
  });

  // Seek to a specific time
  socket.on('seek', ({ roomId, time }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].playback.time = time;
    io.to(roomId).emit('seek', { time });
  });

  // Next track in queue
  socket.on('next', ({ roomId, user }) => {
    if (!rooms[roomId]) return;
    if (rooms[roomId].queue.length > 0) {
      const nextTrack = rooms[roomId].queue.shift();
      rooms[roomId].currentTrack = nextTrack;
      rooms[roomId].playback = { isPlaying: true, time: 0 };
      rooms[roomId].history.push({ track: nextTrack, user, timestamp: Date.now() });
      io.to(roomId).emit('play', { track: nextTrack, time: 0, user });
      io.to(roomId).emit('queue', rooms[roomId].queue);
    }
  });

  // Previous track (not always supported, but included for completeness)
  socket.on('prev', ({ roomId, user }) => {
    // For MVP, this could be a no-op or you could implement a history stack
    // Not implemented here
  });

  // Add a track to the queue
  socket.on('queue:add', ({ roomId, track, user }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].queue.push(track);
    io.to(roomId).emit('queue', rooms[roomId].queue);
  });

  // Remove a track from the queue
  socket.on('queue:remove', ({ roomId, trackId }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].queue = rooms[roomId].queue.filter(t => t.id !== trackId);
    io.to(roomId).emit('queue', rooms[roomId].queue);
  });

  // Manual sync request (client asks for current playback state)
  socket.on('sync', ({ roomId }, cb) => {
    if (!rooms[roomId]) return;
    cb({
      currentTrack: rooms[roomId].currentTrack,
      playback: rooms[roomId].playback,
      queue: rooms[roomId].queue,
      participants: Object.values(rooms[roomId].participants),
      history: rooms[roomId].history
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      delete rooms[roomId].participants[socket.id];
      io.to(roomId).emit('participants', Object.values(rooms[roomId].participants));
    }
  });
});

// Periodic sync: every 5 seconds, broadcast playback time to all clients in each room
// setInterval(() => {
//   for (const roomId in rooms) {
//     const room = rooms[roomId];
//     if (room.currentTrack && room.playback.isPlaying) {
//       // Advance playback time by 5 seconds
//       room.playback.time += 5;
//       io.to(roomId).emit('syncTick', {
//         time: room.playback.time,
//         isPlaying: room.playback.isPlaying,
//         currentTrack: room.currentTrack
//       });
//     }
//   }
// }, 5000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
