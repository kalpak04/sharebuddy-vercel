import React, { useState, useEffect, useRef } from 'react';
import { Box, Button, Typography, Paper, Container, TextField, List, ListItem, ListItemText, Snackbar, Alert, Switch, FormControlLabel, Slider } from '@mui/material';
import { io } from 'socket.io-client';
import axios from 'axios';
import CryptoJS from 'crypto-js';

// Use localhost for development, fallback to production for build
const SOCKET_URL = "https://sharebuddy-vercel.onrender.com";

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
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const [transferMsg, setTransferMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [receivedFile, setReceivedFile] = useState(null);
  const [connRequest, setConnRequest] = useState(null);
  const [peerSocketId, setPeerSocketId] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });
  const [auth, setAuth] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

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
      // Use ipwho.is, a free, no-auth API
      const response = await axios.get('https://ipwho.is/');
      if (response.data.success) {
        return { latitude: response.data.latitude, longitude: response.data.longitude };
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

  // Auth API
  const handleAuth = async () => {
    setAuthError('');
    try {
      const res = await axios.post(`${SOCKET_URL}/${authMode}`, { email: authEmail, password: authPassword });
      setAuth({ token: res.data.token, email: res.data.email });
      setAuthEmail('');
      setAuthPassword('');
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Auth failed');
      setStatus('Error: ' + (err.response?.data?.error || err.message));
      setToast({ open: true, message: 'Auth error: ' + (err.response?.data?.error || err.message), severity: 'error' });
      console.error('Auth error:', err);
    }
  };

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
    try {
      const { latitude, longitude } = await getGeolocation();
      if (geoError) {
        setStatus(geoError);
        return;
      }
      const s = io(SOCKET_URL, { auth: { token: auth?.token }, transports: ['websocket'] });
      setSocket(s);
      setOnline(true);
      setStatus('Online and waiting for renters...');
      // Log registration attempt
      console.info('Registering host:', { reserved, latitude, longitude });
      s.emit('register-host', { storage: reserved, latitude, longitude });
      s.on('file-transfer', async (data) => {
        setStatus(`Receiving file: ${data.filename}`);
        try {
          if (window.electronAPI && window.electronAPI.saveFile) {
            await window.electronAPI.saveFile(folder, data.filename, data.fileBuffer);
            setStoredFiles(prev => [...prev, { name: data.filename, size: data.size }]);
            setStatus(`File saved: ${data.filename}`);
          } else {
            setStatus('File save not available.');
          }
        } catch (err) {
          setStatus('Error saving file.');
          setToast({ open: true, message: 'Error saving file: ' + err.message, severity: 'error' });
          console.error('File save error:', err);
        }
      });
      // --- NEW: Listen for connection requests from renters ---
      s.on('connection-request', async (data) => {
        console.log('Received connection-request event:', data);
        setStatus(`Connection request from renter for file: ${data.filename} (${data.size} bytes)`);
        setConnRequest(data);
        setPeerSocketId(data.from);
        // For MVP, auto-accept:
        s.emit('connection-response', { target: data.from, accept: true });
        // --- Setup WebRTC peer connection ---
        try {
          await setupPeerConnection(data.from);
          setTransferMsg('Setting up connection...');
        } catch (err) {
          setTransferMsg('Connection error: ' + err.message);
          setToast({ open: true, message: 'Connection error: ' + err.message, severity: 'error' });
          console.error('WebRTC setup error:', err);
        }
      });
    } catch (err) {
      setStatus('Go online error: ' + err.message);
      setToast({ open: true, message: 'Go online error: ' + err.message, severity: 'error' });
      console.error('Go online error:', err);
    }
  };

  // --- WebRTC: Handle incoming signals from renter ---
  useEffect(() => {
    if (!socket) return;
    const handleSignal = async (payload) => {
      console.log('Received signal event:', payload);
      if (!peerConnection.current) return;
      if (payload.signal.type === 'offer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.signal));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        socket.emit('signal', { target: payload.from, signal: answer });
      } else if (payload.signal.candidate) {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.signal));
      }
    };
    socket.on('signal', handleSignal);
    socket.on('connection-request', (data) => {
      console.log('Received connection-request event:', data);
      setStatus(`Connection request from renter for file: ${data.filename} (${data.size} bytes)`);
      setConnRequest(data);
      setPeerSocketId(data.from);
      // For MVP, auto-accept:
      socket.emit('connection-response', { target: data.from, accept: true });
      // --- Setup WebRTC peer connection ---
      setupPeerConnection(data.from);
      setTransferMsg('Setting up connection...');
    });
    socket.on('connection-response', (data) => {
      console.log('Received connection-response event:', data);
    });
    return () => {
      socket.off('signal', handleSignal);
      socket.off('connection-request');
      socket.off('connection-response');
    };
  }, [socket]);

  // --- WebRTC: Setup peer connection and data channel ---
  const setupPeerConnection = async (targetSocketId) => {
    console.log('Calling setupPeerConnection:', targetSocketId);
    peerConnection.current = new window.RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });
    peerConnection.current.onicecandidate = (event) => {
      console.log('ICE candidate:', event.candidate);
      if (event.candidate) {
        socket.emit('signal', { target: targetSocketId, signal: event.candidate });
      }
    };
    peerConnection.current.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.current.iceConnectionState);
    };
    peerConnection.current.ondatachannel = (event) => {
      console.log('Host received data channel');
      dataChannel.current = event.channel;
      dataChannel.current.onopen = () => {
        console.log('Data channel opened (host)');
      };
      dataChannel.current.onclose = () => {
        console.log('Data channel closed (host)');
        setTransferMsg('Transfer channel closed.');
      };
      dataChannel.current.onmessage = receiveFileChunks;
    };
  };

  // --- Host: Receive File Chunks ---
  let receivedChunks = [];
  const receiveFileChunks = async (event) => {
    try {
      console.log('Host received chunk:', event.data);
      if (event.data === '__END__') {
        setTransferMsg('Decrypting file...');
        const encrypted = receivedChunks.join('');
        const decrypted = CryptoJS.AES.decrypt(encrypted, 'sharebuddy-key');
        const typedArray = wordArrayToUint8Array(decrypted);
        const blob = new Blob([typedArray]);
        setReceivedFile(blob);
        setTransferMsg('File received and decrypted!');
        setStatus('File received and decrypted!');
        // File type/size validation
        if (connRequest) {
          const maxSize = parseInt(reserved, 10) * 1024 * 1024;
          if (connRequest.size > maxSize) {
            setStatus('File exceeds reserved storage quota.');
            setToast({ open: true, message: 'File exceeds reserved storage quota.', severity: 'error' });
            receivedChunks = [];
            setProgress(0);
            return;
          }
          const allowedTypes = ['pdf', 'txt', 'jpg', 'png', 'jpeg', 'docx'];
          const ext = connRequest.filename.split('.').pop().toLowerCase();
          if (!allowedTypes.includes(ext)) {
            setStatus('File type not allowed.');
            setToast({ open: true, message: 'File type not allowed.', severity: 'error' });
            receivedChunks = [];
            setProgress(0);
            return;
          }
        }
        // Save file to disk
        try {
          if (window.electronAPI && window.electronAPI.saveFile && connRequest) {
            await window.electronAPI.saveFile(folder, connRequest.filename, blob);
            setStoredFiles(prev => [...prev, { name: connRequest.filename, size: connRequest.size }]);
            setStatus(`File saved: ${connRequest.filename}`);
          }
        } catch (err) {
          setStatus('Error saving file.');
          setToast({ open: true, message: 'Error saving file: ' + err.message, severity: 'error' });
          console.error('File save error:', err);
        }
        receivedChunks = [];
        setProgress(100);
      } else {
        receivedChunks.push(event.data);
        setProgress(Math.min(100, Math.round((receivedChunks.join('').length / (connRequest?.size || 1)) * 100)));
      }
    } catch (err) {
      setTransferMsg('File receive error: ' + err.message);
      setStatus('File receive error: ' + err.message);
      setToast({ open: true, message: 'File receive error: ' + err.message, severity: 'error' });
      console.error('File receive error:', err);
    }
  };

  function wordArrayToUint8Array(wordArray) {
    const words = wordArray.words;
    const sigBytes = wordArray.sigBytes;
    const u8 = new Uint8Array(sigBytes);
    let i = 0, j = 0;
    while (i < sigBytes) {
      u8[i++] = (words[j] >> 24) & 0xff;
      if (i === sigBytes) break;
      u8[i++] = (words[j] >> 16) & 0xff;
      if (i === sigBytes) break;
      u8[i++] = (words[j] >> 8) & 0xff;
      if (i === sigBytes) break;
      u8[i++] = words[j++] & 0xff;
    }
    return u8;
  }

  const handleToastClose = () => setToast({ ...toast, open: false });

  // Attach JWT to socket.io connection
  useEffect(() => {
    if (!auth) return;
    const s = io(SOCKET_URL, { auth: { token: auth.token } });
    setSocket(s);
    s.on('connection-request', async (data) => {
      setStatus(`Connection request from renter for file: ${data.filename} (${data.size} bytes)`);
      setConnRequest(data);
      setPeerSocketId(data.from);
      s.emit('connection-response', { target: data.from, accept: true });
      await setupPeerConnection(data.from);
      setTransferMsg('Setting up connection...');
    });
    return () => { s.disconnect(); };
  }, [auth]);

  // Main UI
  if (!auth) {
    return (
      <Container maxWidth="sm" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Paper elevation={6} sx={{ p: 4, mt: 6, borderRadius: 6, backdropFilter: 'blur(8px)', background: darkMode ? 'rgba(30,30,40,0.85)' : 'rgba(255,255,255,0.85)', boxShadow: '0 8px 32px 0 rgba(31,38,135,0.37)', minWidth: 340 }}>
          <Box display="flex" flexDirection="column" alignItems="center" mb={3}>
            <Typography variant="h4" fontWeight={700} gutterBottom>ShareBuddy Host</Typography>
            <Typography variant="subtitle1" color="text.secondary" gutterBottom>Login or Register to continue</Typography>
          </Box>
          <TextField label="Email" type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} fullWidth sx={{ mb: 2 }} autoFocus />
          <TextField label="Password" type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} fullWidth sx={{ mb: 2 }} />
          {authError && <Typography color="error" sx={{ mb: 2 }}>{authError}</Typography>}
          <Button variant="contained" color="primary" fullWidth sx={{ mb: 2 }} onClick={handleAuth}>
            {authMode === 'login' ? 'Login' : 'Register'}
          </Button>
          <Button fullWidth onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} color="secondary">
            {authMode === 'login' ? 'Need an account? Register' : 'Already have an account? Login'}
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Paper elevation={6} sx={{ p: 4, mt: 6, borderRadius: 6, backdropFilter: 'blur(8px)', background: darkMode ? 'rgba(30,30,40,0.85)' : 'rgba(255,255,255,0.85)', boxShadow: '0 8px 32px 0 rgba(31,38,135,0.37)' }}>
        <Box display="flex" flexDirection="column" alignItems="center" mb={3}>
          <Typography variant="h4" fontWeight={700} gutterBottom>ShareBuddy Host</Typography>
          <Typography variant="subtitle1" color="text.secondary" gutterBottom>
            Reserve space and store files for renters
          </Typography>
        </Box>
        <Button variant="outlined" onClick={selectFolder} sx={{ mb: 2 }}>
          {folder ? `Folder: ${folder}` : 'Select Storage Folder'}
        </Button>
        <Slider
          value={reserved}
          onChange={(e, val) => setReserved(val)}
          min={1}
          max={100}
          step={1}
          valueLabelDisplay="on"
          sx={{ mb: 2 }}
        />
        <Box mb={2}>
          <Typography variant="body2" color="text.secondary">{PRIVACY_NOTICE}</Typography>
          <Box display="flex" alignItems="center">
            <input type="checkbox" id="privacy" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} />
            <label htmlFor="privacy" style={{ marginLeft: 8 }}>I understand and accept</label>
          </Box>
        </Box>
        <FormControlLabel
          control={<Switch checked={darkMode} onChange={() => setDarkMode(!darkMode)} />}
          label={darkMode ? 'Dark Mode' : 'Light Mode'}
          sx={{ mb: 2 }}
        />
        <Box display="flex" alignItems="center" mb={2}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: online ? 'linear-gradient(90deg, #00e676, #1de9b6)' : '#ccc',
              boxShadow: online ? '0 0 8px #00e676' : 'none',
              mr: 1,
              animation: online ? 'pulse 1.5s infinite' : 'none',
              '@keyframes pulse': {
                '0%': { boxShadow: '0 0 0 0 #00e676' },
                '70%': { boxShadow: '0 0 0 8px rgba(0,230,118,0)' },
                '100%': { boxShadow: '0 0 0 0 #00e676' }
              }
            }}
          />
          <Typography variant="body2" color={online ? 'success.main' : 'text.secondary'}>
            {online ? 'Online' : 'Offline'}
          </Typography>
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
        <Snackbar open={toast.open} autoHideDuration={4000} onClose={handleToastClose}>
          <Alert onClose={handleToastClose} severity={toast.severity} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        </Snackbar>
      </Paper>
    </Container>
  );
};

export default HostDashboard; 