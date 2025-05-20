require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors({
 origin: 'https://sharebuddy-vercel.vercel.app/',
    methods: ['GET', 'POST'] 
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// PostgreSQL pool
const pool = new Pool();

// Ensure users table exists
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
})();

// Register endpoint
app.post('/register', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, hash]);
    const user = rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: user.email });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered.' });
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Login endpoint
app.post('/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows[0]) return res.status(401).json({ error: 'Invalid credentials.' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });
    const token = jwt.sign({ userId: rows[0].id, email: rows[0].email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: rows[0].email });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token provided.' });
  try {
    const token = auth.split(' ')[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token.' });
  }
}

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

const isValidLatLon = (lat, lon) => {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return true;
};

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required.'));
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = user;
    next();
  } catch {
    next(new Error('Invalid token.'));
  }
});

// Socket.IO signaling for WebRTC peer discovery
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id, 'user:', socket.user?.email);

  socket.on('register-host', async (data) => {
    // Security: Validate and sanitize input
    let { storage, latitude, longitude } = data;
    storage = parseInt(storage, 10);
    if (isNaN(storage) || storage <= 0) storage = null;
    if (!isValidLatLon(latitude, longitude)) {
      latitude = null;
      longitude = null;
    }
    // Privacy: Log registration attempt (never log precise location)
    console.info('Host registration:', {
      socket_id: socket.id,
      user_id: socket.user?.userId,
      email: socket.user?.email,
      storage,
      city_level_location: latitude && longitude ? `[${latitude.toFixed(2)}, ${longitude.toFixed(2)}]` : 'unknown',
      timestamp: new Date().toISOString()
    });
    // Upsert host (one row per socket_id)
    await pool.query(`
      INSERT INTO hosts (socket_id, user_id, storage, latitude, longitude, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (socket_id) DO UPDATE
        SET user_id = $2, storage = $3, latitude = $4, longitude = $5, created_at = NOW()
    `, [socket.id, socket.user?.userId, storage, latitude, longitude]);
    const hosts = await getHosts();
    io.emit('hosts-update', hosts);
  });

  socket.on('register-renter', async (data) => {
    await pool.query('INSERT INTO renters (socket_id, user_id, filename, size) VALUES ($1, $2, $3, $4)', [socket.id, socket.user?.userId, data.filename, data.size]);
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
      SELECT * FROM (
        SELECT *,
          (6371 * acos(
            cos(radians($1)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians($2)) +
            sin(radians($1)) * sin(radians(latitude))
          )) AS distance
        FROM hosts
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ) AS sub
      WHERE distance < $3
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

// Periodic cleanup of stale hosts and renters (older than 10 minutes)
setInterval(async () => {
  try {
    await pool.query("DELETE FROM hosts WHERE created_at < NOW() - INTERVAL '10 minutes'");
    await pool.query("DELETE FROM renters WHERE created_at < NOW() - INTERVAL '10 minutes'");
    const hosts = await getHosts();
    const renters = await getRenters();
    io.emit('hosts-update', hosts);
    io.emit('renters-update', renters);
    console.log('Periodic cleanup: removed stale hosts and renters.');
  } catch (err) {
    console.error('Error during periodic cleanup:', err);
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 
