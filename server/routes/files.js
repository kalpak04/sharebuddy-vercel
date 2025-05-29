const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const storageService = require('../services/storage');
const { authenticateToken } = require('../middleware/auth');

// Upload a file
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const fileKey = await storageService.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // Save file metadata to database
    const file = await req.db.query(
      'INSERT INTO files (key, original_name, size, content_type, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [fileKey, req.file.originalname, req.file.size, req.file.mimetype, req.user.id]
    );

    res.json({
      id: file.rows[0].id,
      key: fileKey,
      originalName: req.file.originalname,
      size: req.file.size,
      contentType: req.file.mimetype
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Get download URL
router.get('/download/:fileKey', authenticateToken, async (req, res) => {
  try {
    const { fileKey } = req.params;

    // Check if file exists and user has access
    const fileCheck = await req.db.query(
      'SELECT * FROM files WHERE key = $1 AND user_id = $2 AND status = $3',
      [fileKey, req.user.id, 'active']
    );

    if (fileCheck.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const downloadUrl = await storageService.generateDownloadUrl(fileKey);
    res.json({ downloadUrl });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// Delete file
router.delete('/:fileKey', authenticateToken, async (req, res) => {
  try {
    const { fileKey } = req.params;

    // Check if file exists and user has access
    const fileCheck = await req.db.query(
      'SELECT * FROM files WHERE key = $1 AND user_id = $2 AND status = $3',
      [fileKey, req.user.id, 'active']
    );

    if (fileCheck.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete from Cloudflare R2
    await storageService.deleteFile(fileKey);

    // Update database status
    await req.db.query(
      'UPDATE files SET status = $1 WHERE key = $2',
      ['deleted', fileKey]
    );

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// List user's files
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const files = await req.db.query(
      'SELECT id, key, original_name, size, content_type, created_at FROM files WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC',
      [req.user.id, 'active']
    );

    res.json(files.rows);
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

module.exports = router; 