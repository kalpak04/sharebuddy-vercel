import React, { useState, useEffect } from 'react';
import { Box, Button, Typography, Paper, Container, TextField, List, ListItem, ListItemText } from '@mui/material';
import { io } from 'socket.io-client';
import axios from 'axios';

const SOCKET_URL = 'https://sharebuddy-vercel.onrender.com'; // Update with your backend URL

const HostDashboard = () => {
  const [folder, setFolder] = useState('');
  const [reserved, setReserved] = useState('');
  const [status, setStatus] = useState('');
  const [online, setOnline] = useState(false);
  const [socket, setSocket] = useState(null);
  const [storedFiles, setStoredFiles] = useState([]);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');

  const PRIVACY_NOTICE = `To help renters find your device, ShareBuddy will use your approximate location (city-level, never your exact address) via a secure IP geolocation service. Your location is only used for matching and never shared with third parties.`;

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

  async function getGeolocation() {
    try {
      setGeoLoading(true);
      setGeoError('');
      // Use a privacy-respecting, rate-limited API
      const response = await axios.get('https://ip-api.com/json/?fields=status,message,lat,lon,city,country');
      if (response.data.status === 'success') {
        return { latitude: response.data.lat, longitude: response.data.lon };
      } else {
        setGeoError('Geolocation failed: ' + response.data.message);
        return { latitude: null, longitude: null };
      }
    } catch (error) {
      setGeoError('Geolocation error: ' + error.message);
      return { latitude: null, longitude: null };
    } finally {
      setGeoLoading(false);
    }
  }

  // Go Online: connect to backend and listen for file transfers
  const goOnline = async () => {
    if (!folder || !reserved) {
      setStatus('Please select a folder and reserve space.');
      return;
    }
    if (!privacyAccepted) {
      setStatus('You must accept the privacy notice to go online.');
      return;
    }
    setStatus('Fetching location...');
    const { latitude, longitude } = await getGeolocation();
    if (geoError) {
      setStatus(geoError);
      return;
    }
    const s = io(SOCKET_URL, { transports: ['websocket'] });
    setSocket(s);
    setOnline(true);
    setStatus('Online and waiting for renters...');
    // Log registration attempt
    console.info('Registering host:', { reserved, latitude, longitude });
    s.emit('register-host', { storage: reserved, latitude, longitude });
    s.on('file-transfer', async (data) => {
      setStatus(`Receiving file: ${data.filename}`);
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
        <Box mb={2}>
          <Typography variant="body2" color="text.secondary">{PRIVACY_NOTICE}</Typography>
          <Box display="flex" alignItems="center">
            <input type="checkbox" id="privacy" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} />
            <label htmlFor="privacy" style={{ marginLeft: 8 }}>I understand and accept</label>
          </Box>
        </Box>
        <Button variant="contained" color="primary" fullWidth sx={{ mb: 2 }} onClick={goOnline} disabled={online || !privacyAccepted || geoLoading}>
          {geoLoading ? 'Locating...' : (online ? 'Online' : 'Go Online')}
        </Button>
        {geoError && <Typography color="error.main">{geoError}</Typography>}
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