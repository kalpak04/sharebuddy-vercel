import React, { useState, useEffect } from 'react';
import { Box, Button, Typography, Paper, Container, TextField, List, ListItem, ListItemText } from '@mui/material';
import { io } from 'socket.io-client';

const SOCKET_URL = 'https://sharebuddy-vercel.onrender.com'; // Update with your backend URL

const HostDashboard = () => {
  const [folder, setFolder] = useState('');
  const [reserved, setReserved] = useState('');
  const [status, setStatus] = useState('');
  const [online, setOnline] = useState(false);
  const [socket, setSocket] = useState(null);
  const [storedFiles, setStoredFiles] = useState([]);

  // Folder selection (Electron dialog)
  const selectFolder = async () => {
    if (window.electronAPI && window.electronAPI.selectFolder) {
      const selected = await window.electronAPI.selectFolder();
      if (selected) {
        setFolder(selected);
        setStatus('');
      } else {
        setStatus('No folder selected.');
      }
    } else {
      setStatus('Folder selection not available.');
    }
  };

  // Go Online: connect to backend and listen for file transfers
  const goOnline = () => {
    if (!folder || !reserved) {
      setStatus('Please select a folder and reserve space.');
      return;
    }
    const s = io(SOCKET_URL);
    setSocket(s);
    setOnline(true);
    setStatus('Online and waiting for renters...');
    s.emit('register-host', { storage: reserved, latitude: null, longitude: null });
    // Listen for file transfer events (custom event, e.g., 'file-transfer')
    s.on('file-transfer', async (data) => {
      setStatus(`Receiving file: ${data.filename}`);
      // Save file to disk using Electron IPC (to be implemented in preload/main)
      if (window.electronAPI && window.electronAPI.saveFile) {
        await window.electronAPI.saveFile(folder, data.filename, data.fileBuffer);
        setStoredFiles(prev => [...prev, { name: data.filename, size: data.size }]);
        setStatus(`File saved: ${data.filename}`);
      } else {
        setStatus('File save not available.');
      }
    });
  };

  return (
    <Container maxWidth="sm" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Paper elevation={6} sx={{ p: 4, mt: 6, borderRadius: 4 }}>
        <Box display="flex" flexDirection="column" alignItems="center" mb={3}>
          <Typography variant="h4" fontWeight={700} gutterBottom>ShareBuddy Host</Typography>
          <Typography variant="subtitle1" color="text.secondary" gutterBottom>
            Reserve space and store files for renters
          </Typography>
        </Box>
        <Button variant="outlined" onClick={selectFolder} sx={{ mb: 2 }}>
          {folder ? `Folder: ${folder}` : 'Select Storage Folder'}
        </Button>
        <TextField
          label="Reserve Space (GB)"
          type="number"
          value={reserved}
          onChange={e => setReserved(e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        />
        <Button variant="contained" color="primary" fullWidth sx={{ mb: 2 }} onClick={goOnline} disabled={online}>
          {online ? 'Online' : 'Go Online'}
        </Button>
        {status && <Typography color="info.main">{status}</Typography>}
        <Box mt={4}>
          <Typography variant="subtitle2">Stored Files:</Typography>
          <List>
            {storedFiles.length === 0 && <ListItem><ListItemText primary="No files stored yet." /></ListItem>}
            {storedFiles.map((f, i) => (
              <ListItem key={i}><ListItemText primary={f.name} secondary={`${f.size} bytes`} /></ListItem>
            ))}
          </List>
        </Box>
      </Paper>
    </Container>
  );
};

export default HostDashboard; 