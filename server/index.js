require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// PostgreSQL pool
const pool = new Pool();

// REST endpoint for health check
app.get('/', (req, res) => {
  res.send('ShareBuddy Signaling Server is running');
});

// Helper: get all hosts
async function getHosts() {
  const { rows } = await pool.query('SELECT * FROM hosts');
  return rows;
}
// Helper: get all renters
async function getRenters() {
  const { rows } = await pool.query('SELECT * FROM renters');
  return rows;
}

// Socket.IO signaling for WebRTC peer discovery
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('register-host', async (data) => {
    await pool.query('INSERT INTO hosts (socket_id, storage, latitude, longitude) VALUES ($1, $2, $3, $4)', [socket.id, data.storage, data.latitude, data.longitude]);
    const hosts = await getHosts();
    io.emit('hosts-update', hosts);
  });

  socket.on('register-renter', async (data) => {
    await pool.query('INSERT INTO renters (socket_id, filename, size) VALUES ($1, $2, $3)', [socket.id, data.filename, data.size]);
    const renters = await getRenters();
    io.emit('renters-update', renters);
  });

  socket.on('signal', (payload) => {
    io.to(payload.target).emit('signal', {
      from: socket.id,
      signal: payload.signal
    });
  });

  // New: Connection request from renter to host
  socket.on('connection-request', (payload) => {
    io.to(payload.target).emit('connection-request', {
      from: socket.id,
      filename: payload.filename,
      size: payload.size
    });
  });

  // New: Connection response from host to renter
  socket.on('connection-response', (payload) => {
    io.to(payload.target).emit('connection-response', {
      accept: payload.accept
    });
  });

  // New: Get nearby hosts for a renter
  socket.on('get-nearby-hosts', async (data) => {
    // data: { latitude, longitude, radiusKm }
    const { latitude, longitude, radiusKm } = data;
    const { rows } = await pool.query(`
      SELECT *,
        (6371 * acos(
          cos(radians($1)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(latitude))
        )) AS distance
      FROM hosts
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      HAVING (6371 * acos(
        cos(radians($1)) * cos(radians(latitude)) *
        cos(radians(longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(latitude))
      )) < $3
      ORDER BY distance ASC
    `, [latitude, longitude, radiusKm]);
    socket.emit('nearby-hosts', rows);
  });

  socket.on('disconnect', async () => {
    await pool.query('DELETE FROM hosts WHERE socket_id = $1', [socket.id]);
    await pool.query('DELETE FROM renters WHERE socket_id = $1', [socket.id]);
    const hosts = await getHosts();
    const renters = await getRenters();
    io.emit('hosts-update', hosts);
    io.emit('renters-update', renters);
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 