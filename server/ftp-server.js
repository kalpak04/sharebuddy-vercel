const FtpSrv = require('ftp-srv');
const path = require('path');
const fs = require('fs').promises;
const { pool } = require('./db');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Enhanced logging function
const log = {
  info: (msg, data) => console.log(`[FTP] ${msg}`, data || ''),
  error: (msg, err) => console.error(`[FTP ERROR] ${msg}:`, err),
  debug: (msg, data) => process.env.DEBUG && console.log(`[FTP DEBUG] ${msg}`, data || '')
};

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdir(UPLOADS_DIR, { recursive: true })
  .then(() => log.info('Uploads directory ensured'))
  .catch(err => log.error('Failed to create uploads directory', err));

const ftpServer = new FtpSrv({
  url: process.env.FTP_URL || 'ftp://0.0.0.0:21',
  anonymous: false,
  pasv_url: process.env.PASV_URL || process.env.PUBLIC_IP || '127.0.0.1',
  pasv_min: parseInt(process.env.PASV_MIN, 10) || 1024,
  pasv_max: parseInt(process.env.PASV_MAX, 10) || 65535,
  tls: false,
  timeout: 60000, // 60 seconds timeout
  greeting: ['Welcome to ShareBuddy FTP Server', 'This server is for authorized users only'],
  blacklist: ['RMD', 'DELE', 'RNFR', 'RNTO'], // Prevent destructive operations
});

// Verify JWT token with enhanced error handling
const verifyToken = async (token) => {
  try {
    if (!token) throw new Error('No token provided');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    if (!rows[0]) throw new Error('User not found');
    return rows[0];
  } catch (err) {
    log.error('Token verification failed', err);
    return null;
  }
};

// Enhanced storage validation
const validateStorage = async (hostSocketId) => {
  try {
    const { rows: hostRows } = await pool.query('SELECT * FROM hosts WHERE socket_id = $1', [hostSocketId]);
    if (!hostRows[0]) throw new Error('Host not found');

    const { rows: usedRows } = await pool.query(
      'SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE host_socket_id = $1',
      [hostSocketId]
    );
    
    const usedStorage = parseInt(usedRows[0].used, 10);
    const totalStorage = hostRows[0].storage * 1024 * 1024 * 1024; // Convert GB to bytes
    const availableStorage = totalStorage - usedStorage;

    return {
      host: hostRows[0],
      used: usedStorage,
      available: availableStorage,
      total: totalStorage
    };
  } catch (err) {
    log.error('Storage validation failed', err);
    throw err;
  }
};

ftpServer.on('login', async ({ username, password }, resolve, reject) => {
  try {
    log.info('Login attempt', { username: username.substring(0, 10) + '...' });
    
    const user = await verifyToken(username);
    if (!user) {
      log.error('Login failed - Invalid token', { username: username.substring(0, 10) + '...' });
      return reject(new Error('Invalid token'));
    }

    const storage = await validateStorage(password);
    if (storage.available <= 0) {
      log.error('Login failed - No storage available', { hostSocketId: password });
      return reject(new Error('No storage available'));
    }

    // Create user's directory if it doesn't exist
    const userDir = path.join(UPLOADS_DIR, user.id.toString());
    await fs.mkdir(userDir, { recursive: true });
    log.info('User directory created/verified', { userDir });

    // Set up user's FTP session with enhanced metadata
    const connectionInfo = {
      fs: {
        root: userDir,
      },
      client: {
        userId: user.id,
        hostSocketId: password,
        availableStorage: storage.available,
        username: user.username,
        connectionTime: new Date().toISOString()
      },
    };

    log.info('Login successful', { 
      userId: user.id,
      username: user.username,
      availableStorage: Math.floor(storage.available / (1024 * 1024)) + 'MB'
    });

    resolve(connectionInfo);
  } catch (err) {
    log.error('Login error', err);
    reject(new Error('Login failed: ' + err.message));
  }
});

// Enhanced file upload handling
ftpServer.on('STOR', async ({ connection, file }) => {
  const startTime = Date.now();
  try {
    const { userId, hostSocketId, username } = connection.client;
    const filePath = path.join(connection.fs.root, file.name);
    
    log.info('File upload started', {
      filename: file.name,
      userId,
      username,
      hostSocketId
    });

    // Wait for file to be fully written
    await new Promise(resolve => setTimeout(resolve, 1000));
    const stats = await fs.stat(filePath);

    // Validate final file size against available storage
    const storage = await validateStorage(hostSocketId);
    if (stats.size > storage.available) {
      log.error('File too large for remaining storage', {
        fileSize: stats.size,
        available: storage.available
      });
      await fs.unlink(filePath);
      throw new Error('File too large for remaining storage');
    }

    // Update database with file information
    await pool.query(
      'INSERT INTO files (user_id, host_socket_id, filename, size, path) VALUES ($1, $2, $3, $4, $5)',
      [userId, hostSocketId, file.name, stats.size, filePath]
    );

    // Calculate transfer speed
    const transferTime = (Date.now() - startTime) / 1000; // seconds
    const speedMBps = (stats.size / (1024 * 1024)) / transferTime;

    // Notify connected clients about the update
    const io = require('./index').io;
    io.to(hostSocketId).emit('file-transfer', {
      filename: file.name,
      size: stats.size,
      userId,
      username,
      transferSpeed: speedMBps.toFixed(2) + ' MB/s',
      timestamp: new Date().toISOString()
    });

    log.info('File upload completed', {
      filename: file.name,
      size: Math.floor(stats.size / 1024) + 'KB',
      speed: speedMBps.toFixed(2) + ' MB/s',
      duration: transferTime.toFixed(2) + 's'
    });

  } catch (err) {
    log.error('File upload error', err);
    // Notify about failure
    const io = require('./index').io;
    io.to(connection.client.hostSocketId).emit('file-transfer-error', {
      filename: file.name,
      error: err.message
    });
  }
});

// Handle server events
ftpServer.on('client-error', ({ connection, context, error }) => {
  log.error('Client error', { error, context, clientId: connection?.id });
});

ftpServer.on('disconnect', ({ connection }) => {
  log.info('Client disconnected', { 
    userId: connection?.client?.userId,
    username: connection?.client?.username
  });
});

// Start FTP server with enhanced error handling
const startFtpServer = async () => {
  try {
    await ftpServer.listen();
    log.info('FTP Server running', {
      port: 21,
      pasv_range: `${ftpServer.options.pasv_min}-${ftpServer.options.pasv_max}`,
      pasv_url: ftpServer.options.pasv_url
    });
  } catch (err) {
    log.error('Failed to start FTP server', err);
    process.exit(1);
  }
};

startFtpServer();

module.exports = ftpServer; 