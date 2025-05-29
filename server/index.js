require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, 'uploads');
      fs.mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch(err => cb(err));
    },
    filename: (req, file, cb) => {
      // Generate unique filename
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: {
    fileSize: 1024 * 1024 * 1024 * 2, // 2GB max file size
    files: 1 // Max number of files
  },
  fileFilter: (req, file, cb) => {
    // Add any file type restrictions here if needed
    cb(null, true);
  }
}).single('file');
const ftpServer = require('./ftp-server');
const { pool, checkDatabaseHealth } = require('./db');

const app = express();
app.use(helmet());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use(cors({
  origin: [
    'https://sharebuddy-vercel.vercel.app',
    'https://sharebuddy-vercel.vercel.app/',
    'https://sharebuddy.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.options('*', cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(`${signal} signal received: closing HTTP server...`);
  
  // Stop accepting new requests
  server.close(() => {
    console.log('HTTP server closed');
    
    // Close database pool
    pool.end().then(() => {
      console.log('Database pool has ended');
      process.exit(0);
    }).catch((err) => {
      console.error('Error closing database pool:', err);
      process.exit(1);
    });
  });

  // Force close after timeout
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

// Ensure all tables exist (users, hosts, renters, files)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS hosts (
        socket_id VARCHAR(255) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        storage INTEGER,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS renters (
        socket_id VARCHAR(255) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        filename VARCHAR(255),
        size INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        host_socket_id VARCHAR(255),
        filename VARCHAR(255),
        size INTEGER,
        path VARCHAR(255),
        uploaded_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Database tables created successfully');
  } catch (err) {
    console.error('Error creating database tables:', err);
    // Don't exit process in production, just log the error
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }
})();

// Register endpoint
app.post('/register',
  [
    body('email').isEmail().withMessage('Invalid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters')
  ],
  async (req, res) => {
    try {
      console.log('Registration request received:', {
        email: req.body.email,
        username: req.body.username,
        headers: req.headers
      });

      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('Validation errors:', errors.array());
        return res.status(400).json({ 
          error: 'Validation failed',
          details: errors.array().map(e => e.msg)
        });
      }

      const { email, password, username } = req.body;
      
      // Check if user already exists (either email or username)
      const existingUser = await pool.query(
        'SELECT id, email, username FROM users WHERE email = $1 OR username = $2',
        [email, username]
      );
      
      if (existingUser.rows.length > 0) {
        const existing = existingUser.rows[0];
        return res.status(409).json({ 
          error: 'User already exists',
          details: existing.email === email ? 'Email already registered' : 'Username already taken'
        });
      }
      
      // Hash password
      const hash = await bcrypt.hash(password, 12);
      
      // Create user
      const { rows } = await pool.query(
        'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
        [username, email, hash]
      );
      
      const user = rows[0];
      
      // Generate JWT
      const token = jwt.sign(
        { 
          userId: user.id,
          username: user.username,
          email: user.email 
        },
        JWT_SECRET,
        { 
          expiresIn: '7d',
          algorithm: 'HS256'
        }
      );
      
      console.log('Registration successful for:', user.email);
      
      // Send success response
      res.status(201).json({ 
        message: 'Registration successful',
        token, 
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      });
      
    } catch (err) {
      console.error('Registration error:', {
        error: err.message,
        stack: err.stack,
        body: req.body
      });
      
      res.status(500).json({ 
        error: 'Registration failed',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
      });
    }
  }
);

// Login endpoint
app.post('/login',
  [
    body('email').isEmail().withMessage('Invalid email'),
    body('password').notEmpty().withMessage('Password required')
  ],
  async (req, res) => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array().map(e => e.msg).join(', ') });
      }

      const { email, password } = req.body;
      
      // Get user
      const { rows } = await pool.query(
        'SELECT id, username, email, password FROM users WHERE email = $1',
        [email]
      );
      
      if (!rows[0]) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Verify password
      const valid = await bcrypt.compare(password, rows[0].password);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Generate JWT
      const token = jwt.sign(
        { 
          userId: rows[0].id,
          username: rows[0].username,
          email: rows[0].email 
        },
        JWT_SECRET,
        { 
          expiresIn: '7d',
          algorithm: 'HS256'
        }
      );
      
      // Send success response
      res.json({ 
        message: 'Login successful',
        token,
        user: {
          id: rows[0].id,
          username: rows[0].username,
          email: rows[0].email
        }
      });
      
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ 
        error: 'Login failed',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
      });
    }
  }
);

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

// Enhanced file upload endpoint with progress tracking
app.post('/upload', authMiddleware, (req, res) => {
  upload(req, res, async (err) => {
    const startTime = Date.now();
    
    try {
      // Handle multer errors
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size too large. Maximum size is 2GB.' });
        }
        throw err;
      } else if (err) {
        throw err;
      }

      const file = req.file;
      const userId = req.user.userId;
      const hostSocketId = req.body.hostSocketId;
      
      console.log('Upload request received:', {
        userId,
        hostSocketId,
        filename: file?.originalname,
        size: file?.size,
        mimetype: file?.mimetype
      });

      if (!file || !hostSocketId) {
        return res.status(400).json({ error: 'File and hostSocketId are required.' });
      }

      // Check host's reserved storage
      const { rows: hostRows } = await pool.query('SELECT storage, user_id FROM hosts WHERE socket_id = $1', [hostSocketId]);
      if (!hostRows[0]) {
        // Cleanup: remove uploaded file
        await fs.unlink(file.path);
        return res.status(404).json({ error: 'Host not found.' });
      }

      const reservedStorage = (hostRows[0].storage || 0) * 1024 * 1024 * 1024; // Convert GB to bytes
      
      // Calculate used storage
      const { rows: usedRows } = await pool.query(
        'SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE host_socket_id = $1',
        [hostSocketId]
      );
      
      const usedStorage = parseInt(usedRows[0].used, 10);
      const availableStorage = reservedStorage - usedStorage;

      console.log('Storage check:', {
        hostId: hostRows[0].user_id,
        reserved: Math.floor(reservedStorage / (1024 * 1024)) + 'MB',
        used: Math.floor(usedStorage / (1024 * 1024)) + 'MB',
        available: Math.floor(availableStorage / (1024 * 1024)) + 'MB',
        fileSize: Math.floor(file.size / (1024 * 1024)) + 'MB'
      });

      if (file.size > availableStorage) {
        // Cleanup: remove uploaded file
        await fs.unlink(file.path);
        return res.status(400).json({ 
          error: 'Not enough storage available on host.',
          available: Math.floor(availableStorage / (1024 * 1024)) + 'MB',
          required: Math.floor(file.size / (1024 * 1024)) + 'MB'
        });
      }

      // Store file metadata in DB
      const { rows: fileRows } = await pool.query(
        'INSERT INTO files (user_id, host_socket_id, filename, size, path) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, hostSocketId, file.originalname, file.size, file.path]
      );

      // Calculate transfer metrics
      const transferTime = (Date.now() - startTime) / 1000; // seconds
      const speedMBps = (file.size / (1024 * 1024)) / transferTime;

      // Notify connected clients
      io.to(hostSocketId).emit('file-transfer', {
        fileId: fileRows[0].id,
        filename: file.originalname,
        size: file.size,
        path: file.path,
        userId: req.user.userId,
        username: req.user.username,
        transferSpeed: speedMBps.toFixed(2) + ' MB/s',
        timestamp: new Date().toISOString()
      });

      console.log('Upload completed:', {
        fileId: fileRows[0].id,
        filename: file.originalname,
        size: Math.floor(file.size / 1024) + 'KB',
        speed: speedMBps.toFixed(2) + ' MB/s',
        duration: transferTime.toFixed(2) + 's'
      });

      res.status(200).json({ 
        message: 'File uploaded successfully',
        fileId: fileRows[0].id,
        transferSpeed: speedMBps.toFixed(2) + ' MB/s',
        duration: transferTime.toFixed(2) + 's'
      });

    } catch (error) {
      console.error('Upload error:', error);
      
      // Cleanup: remove uploaded file if it exists
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          console.error('Error removing failed upload:', unlinkError);
        }
      }

      // Notify clients about failure if we have the connection info
      if (req.body.hostSocketId) {
        io.to(req.body.hostSocketId).emit('file-transfer-error', {
          filename: req.file?.originalname,
          error: error.message
        });
      }

      res.status(500).json({ 
        error: 'File upload failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  });
});

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  const dbHealthy = await checkDatabaseHealth();
  const status = {
    server: true,
    database: dbHealthy,
    timestamp: new Date().toISOString()
  };
  
  if (!dbHealthy) {
    return res.status(503).json(status);
  }
  
  res.json(status);
});

// Attach shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Add before the app.listen() call
ftpServer.on('error', (err) => {
  console.error('FTP server error:', err);
});

// Export io for use in ftp-server.js
module.exports.io = io;

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 
