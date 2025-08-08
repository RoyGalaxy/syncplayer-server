const express = require('express');
const cors = require('cors');

require('dotenv').config();

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://syncplayer-client.vercel.app",
  ],
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

// Routes
app.use('/api/search', require('./routes/search.js'));

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://syncplayer-client.vercel.app",
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
      playback: {
        currentTrack: null,
        playing: false,
        lastPlayer: null,
        playedSeconds: 0,
        internalSeek: true
      },
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
  socket.on('play', ({ roomId, track, playedSeconds, user }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].playback = { playing: true, playedSeconds, currentTrack: track, lastPlayer: user, internalSeek: true };
    rooms[roomId].history.push({ track, user, timestamp: Date.now() });
    io.to(roomId).emit('play', { track, playedSeconds, user });
  });

  // Pause playback
  socket.on('pause', ({ roomId, playedSeconds }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].playback.isPlaying = false;
    rooms[roomId].playback.playedSeconds = playedSeconds;
    io.to(roomId).emit('pause', { playedSeconds });
  });

  // Seek to a specific time
  socket.on('seek', ({ roomId, playedSeconds }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].playback.playedSeconds = playedSeconds;
    io.to(roomId).emit('seek', { playedSeconds });
  });

  // Next track in queue
  socket.on('next', ({ roomId, user }) => {
    if (!rooms[roomId]) return;
    if (rooms[roomId].queue.length > 0) {
      const nextTrack = rooms[roomId].queue.shift();
      rooms[roomId].currentTrack = nextTrack;
      rooms[roomId].playback = { isPlaying: true, playedSeconds: 0 };
      rooms[roomId].history.push({ track: nextTrack, user, timestamp: Date.now() });
      io.to(roomId).emit('play', { track: nextTrack, playedSeconds: 0, user });
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
