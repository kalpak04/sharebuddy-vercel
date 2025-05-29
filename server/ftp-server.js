const FtpSrv = require('ftp-srv');
const path = require('path');
const fs = require('fs').promises;
const { pool } = require('./db');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const ftpServer = new FtpSrv({
  url: 'ftp://0.0.0.0:21',
  anonymous: false,
  pasv_url: process.env.PASV_URL || '127.0.0.1',
  pasv_min: 1024,
  pasv_max: 65535,
  tls: false, // We'll handle encryption at the application level
});

// Verify JWT token from username field
const verifyToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    return rows[0];
  } catch (err) {
    return null;
  }
};

ftpServer.on('login', async ({ username, password }, resolve, reject) => {
  try {
    // Use username field for JWT token
    const user = await verifyToken(username);
    if (!user) {
      return reject(new Error('Invalid token'));
    }

    // Get host information from password field (host socket ID)
    const { rows: hostRows } = await pool.query('SELECT * FROM hosts WHERE socket_id = $1', [password]);
    if (!hostRows[0]) {
      return reject(new Error('Host not found'));
    }

    // Check storage limits
    const { rows: usedRows } = await pool.query(
      'SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE host_socket_id = $1',
      [password]
    );
    const usedStorage = parseInt(usedRows[0].used, 10);
    const availableStorage = (hostRows[0].storage * 1024 * 1024 * 1024) - usedStorage;

    // Create user's directory if it doesn't exist
    const userDir = path.join(__dirname, 'uploads', user.id.toString());
    await fs.mkdir(userDir, { recursive: true });

    // Set up user's FTP session
    const connectionInfo = {
      fs: {
        root: userDir,
      },
      client: {
        userId: user.id,
        hostSocketId: password,
        availableStorage,
      },
    };

    resolve(connectionInfo);
  } catch (err) {
    reject(err);
  }
});

// Handle file upload completion
ftpServer.on('STOR', async ({ connection, file }) => {
  try {
    const { userId, hostSocketId } = connection.client;
    const filePath = path.join(connection.fs.root, file.name);
    const stats = await fs.stat(filePath);

    // Update database with file information
    await pool.query(
      'INSERT INTO files (user_id, host_socket_id, filename, size, path) VALUES ($1, $2, $3, $4, $5)',
      [userId, hostSocketId, file.name, stats.size, filePath]
    );

    // Notify connected clients about the update
    const io = require('./index').io;
    io.to(hostSocketId).emit('file-transfer', {
      filename: file.name,
      size: stats.size,
      userId,
    });
  } catch (err) {
    console.error('Error handling file upload:', err);
  }
});

// Start FTP server
ftpServer.listen()
  .then(() => {
    console.log('FTP Server running on port 21');
  })
  .catch(err => {
    console.error('Error starting FTP server:', err);
  });

module.exports = ftpServer; 