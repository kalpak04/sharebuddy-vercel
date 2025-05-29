import React, { useState, useEffect, useRef } from 'react';
import { Box, Button, Typography, Paper, Container, Grid, TextField, Avatar, CircularProgress, List, ListItem, ListItemText, Dialog, DialogTitle, DialogContent, DialogActions, ThemeProvider, createTheme, CssBaseline, Switch, FormControlLabel } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import StorageIcon from '@mui/icons-material/Storage';
import BackupIcon from '@mui/icons-material/Backup';
import logo from './logo.svg';
import { io, Socket } from 'socket.io-client';
import CryptoJS from 'crypto-js';

// IMPORTANT: Update this URL after backend deployment
const SOCKET_URL = 'https://sharebuddy-vercel.onrender.com';
const SIGNAL_EVENT = 'signal';
const REQUEST_EVENT = 'connection-request';
const RESPONSE_EVENT = 'connection-response';
const CHUNK_SIZE = 64 * 1024;

type Step = 'choose' | 'host-wait' | 'renter-wait' | 'transfer' | 'done';
type PeerRole = 'host' | 'renter';

type ConnectionRequest = {
  from: string;
  filename: string;
  size: number;
};

// --- Types for hosts and renters ---
interface Host {
  id?: string;
  socket_id: string;
  storage: number;
  distance?: number;
}
interface Renter {
  id?: string;
  socket_id: string;
  filename?: string;
  size?: number;
}

const App: React.FC = () => {
  const [role, setRole] = useState<PeerRole | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [storage, setStorage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [renters, setRenters] = useState<Renter[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transferMsg, setTransferMsg] = useState('');
  const [receivedFile, setReceivedFile] = useState<Blob | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const [peerSocketId, setPeerSocketId] = useState<string | null>(null);
  const [connRequest, setConnRequest] = useState<ConnectionRequest | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [auth, setAuth] = useState<{ token: string; email: string } | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: '#1976d2' },
      secondary: { main: '#00bfae' },
      background: {
        default: darkMode ? '#181c24' : '#f4f7fa',
        paper: darkMode ? 'rgba(30,30,40,0.85)' : 'rgba(255,255,255,0.85)'
      }
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: 'Inter, Roboto, Arial, sans-serif',
      h4: { fontWeight: 800, letterSpacing: '-1px' },
      subtitle1: { fontWeight: 500 },
      button: { textTransform: 'none', fontWeight: 600 }
    }
  });

  // TODO: Move encryption key to a secure location for production
  const ENCRYPTION_KEY = 'sharebuddy-key';

  // Auth API
  const handleAuth = async () => {
    setAuthError('');
    try {
      const res = await fetch(`${SOCKET_URL}/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auth failed');
      setAuth({ token: data.token, email: data.email });
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: any) {
      setAuthError(err.message);
      setStatus('Error: ' + err.message);
      console.error('Auth error:', err);
    }
  };

  // Connect to backend on mount
  useEffect(() => {
    if (!auth) return;
    const s = io(SOCKET_URL, { auth: { token: auth.token } });
    setSocket(s);
    s.on('hosts-update', setHosts);
    s.on('renters-update', setRenters);
    s.on(SIGNAL_EVENT, handleSignal);
    s.on(REQUEST_EVENT, handleConnectionRequest);
    s.on(RESPONSE_EVENT, handleConnectionResponse);
    return () => { s.disconnect(); };
    // eslint-disable-next-line
  }, [auth]);

  // --- WebRTC Signaling Logic ---
  const handleSignal = async (payload: any) => {
    try {
      console.log('Received signal event:', payload);
      if (!peerConnection.current) return;
      if (payload.signal.type === 'offer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.signal));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        socket?.emit(SIGNAL_EVENT, { target: payload.from, signal: answer });
      } else if (payload.signal.type === 'answer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.signal));
      } else if (payload.signal.candidate) {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.signal));
      }
    } catch (err: any) {
      setStatus('WebRTC signaling error: ' + err.message);
      console.error('WebRTC signaling error:', err);
    }
  };

  // --- Host: Handle incoming connection requests ---
  const handleConnectionRequest = (req: ConnectionRequest) => {
    console.log('Received connection-request event:', req);
    setConnRequest(req);
    setShowDialog(true);
  };

  // --- Host: Accept/Decline connection ---
  const respondToRequest = async (accept: boolean) => {
    setShowDialog(false);
    if (accept && connRequest) {
      setPeerSocketId(connRequest.from);
      await setupPeerConnection('host', connRequest.from);
      setStatus('Connecting to renter...');
      setStep('transfer');
      socket?.emit(RESPONSE_EVENT, { target: connRequest.from, accept: true });
    } else if (connRequest) {
      socket?.emit(RESPONSE_EVENT, { target: connRequest.from, accept: false });
      setStatus('Declined connection request.');
    }
    setConnRequest(null);
  };

  // --- Renter: Handle host response ---
  const handleConnectionResponse = async (payload: { accept: boolean }) => {
    console.log('Received connection-response event:', payload);
    if (payload.accept) {
      setStatus('Host accepted. Connecting...');
      setStep('transfer');
    } else {
      setStatus('Host declined your request.');
      setStep('renter-wait');
      setPeerSocketId(null);
    }
  };

  // --- Host: Go Online ---
  const goOnlineAsHost = () => {
    if (socket && storage) {
      setLoading(true);
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        socket.emit('register-host', { storage, latitude, longitude });
        setStatus('Waiting for renters...');
        setStep('host-wait');
        setLoading(false);
      }, (err) => {
        setStatus('Location required to offer storage. Error: ' + err.message);
        setLoading(false);
      });
    } else {
      setStatus('Please enter available storage.');
    }
  };

  // --- Renter: Find Storage and Request Connection ---
  const findStorage = async () => {
    if (socket && file) {
      setLoading(true);
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        socket.emit('get-nearby-hosts', { latitude, longitude, radiusKm: 10 });
        setStatus('Searching for nearby hosts...');
        setLoading(false);
      }, (err) => {
        setStatus('Location required to find storage. Error: ' + err.message);
        setLoading(false);
      });
    } else {
      setStatus('Please select a file to store.');
    }
  };

  // --- Renter: Connect to selected host ---
  const connectToHost = (host: Host) => {
    if (socket && file && host) {
      setPeerSocketId(host.socket_id);
      setSelectedHost(host);
      socket.emit(REQUEST_EVENT, { target: host.socket_id, filename: file.name, size: file.size, from: socket.id });
      setStatus('Requesting connection to host...');
    } else {
      setStatus('Please select a file and a host.');
    }
  };

  // Listen for nearby hosts and update UI
  useEffect(() => {
    if (!socket) return;
    const handleNearbyHosts = (hosts: Host[]) => setHosts(hosts);
    socket.on('nearby-hosts', handleNearbyHosts);
    return () => { socket.off('nearby-hosts', handleNearbyHosts); };
  }, [socket]);

  // --- Setup WebRTC Peer Connection ---
  const setupPeerConnection = async (myRole: PeerRole, targetSocketId: string) => {
    console.log('Calling setupPeerConnection:', myRole, targetSocketId);
    peerConnection.current = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });
    peerConnection.current.onicecandidate = (event) => {
      console.log('ICE candidate:', event.candidate);
      if (event.candidate) {
        socket?.emit(SIGNAL_EVENT, { target: targetSocketId, signal: event.candidate });
      }
    };
    peerConnection.current.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.current?.iceConnectionState);
    };
    if (myRole === 'renter') {
      dataChannel.current = peerConnection.current.createDataChannel('file');
      dataChannel.current.onopen = () => {
        console.log('Data channel opened (renter)');
        sendFileChunks();
      };
      dataChannel.current.onclose = () => {
        console.log('Data channel closed (renter)');
        setTransferMsg('Transfer channel closed.');
      };
      dataChannel.current.onmessage = (event) => {
        console.log('Renter received message:', event.data);
      };
    } else {
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
    }
    if (myRole === 'renter') {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      socket?.emit(SIGNAL_EVENT, { target: targetSocketId, signal: offer });
    }
  };

  // --- Host: Receive File Chunks ---
  const receivedChunksRef = useRef<string[]>([]);
  const receiveFileChunks = (event: MessageEvent) => {
    try {
      console.log('Host received chunk:', event.data);
      if (event.data === '__END__') {
        setTransferMsg('Decrypting file...');
        const encrypted = receivedChunksRef.current.join('');
        // Decrypt from base64
        const decrypted = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
        const typedArray = wordArrayToUint8Array(decrypted);
        const blob = new Blob([typedArray]);
        setReceivedFile(blob);
        setTransferMsg('File received and decrypted!');
        setStep('done');
        receivedChunksRef.current = [];
        setProgress(100);
      } else {
        receivedChunksRef.current.push(event.data);
        // Use connRequest?.size for progress calculation
        setProgress(Math.min(100, Math.round((receivedChunksRef.current.join('').length / (connRequest?.size || 1)) * 100)));
      }
    } catch (err: any) {
      setTransferMsg('File receive error: ' + err.message);
      setStatus('File receive error: ' + err.message);
      console.error('File receive error:', err);
    }
  };

  function wordArrayToUint8Array(wordArray: CryptoJS.lib.WordArray) {
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const reset = () => {
    setRole(null);
    setStep('choose');
    setStorage('');
    setFile(null);
    setStatus('');
    setProgress(0);
    setTransferMsg('');
    setReceivedFile(null);
    setPeerSocketId(null);
    setConnRequest(null);
    setShowDialog(false);
    if (peerConnection.current) peerConnection.current.close();
    peerConnection.current = null;
    dataChannel.current = null;
    setSelectedHost(null);
  };

  // Add after connectToHost function
  const uploadFileToHost = async () => {
    if (!file || !selectedHost || !auth) {
      setStatus('Missing file, host, or authentication.');
      return;
    }
    setLoading(true);
    setStatus('Uploading file to host...');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('hostSocketId', selectedHost.socket_id);
      const res = await fetch(`${SOCKET_URL}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${auth.token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setStatus('File uploaded successfully!');
      setStep('done');
    } catch (err: any) {
      setStatus('Upload error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Renter: Send File Chunks ---
  const sendFileChunks = async () => {
    if (!file || !dataChannel.current) {
      setStatus('No file or data channel for transfer.');
      return;
    }
    try {
      console.log('Data channel open, starting file transfer...');
      setTransferMsg('Encrypting file...');
      const arrayBuffer = await file.arrayBuffer();
      const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer as any);
      // Encrypt and encode as base64
      const encrypted = CryptoJS.AES.encrypt(wordArray, ENCRYPTION_KEY).toString();
      setTransferMsg('Sending file...');
      let offset = 0;
      while (offset < encrypted.length) {
        const chunk = encrypted.slice(offset, offset + CHUNK_SIZE);
        dataChannel.current.send(chunk);
        console.log('Sent chunk:', chunk.length, 'bytes');
        offset += CHUNK_SIZE;
        setProgress(Math.min(100, Math.round((offset / encrypted.length) * 100)));
        await new Promise((res) => setTimeout(res, 10));
      }
      dataChannel.current.send('__END__');
      console.log('Sent __END__');
      setTransferMsg('File sent!');
      setStep('done');
    } catch (err: any) {
      setTransferMsg('File transfer error: ' + err.message);
      setStatus('File transfer error: ' + err.message);
      console.error('File transfer error:', err);
    }
  };

  // --- UI/UX Clarification for Transfer Flows ---
  // If both uploadFileToHost and peer-to-peer are available, show a warning
  const bothFlowsAvailable = !!(selectedHost && file && socket && dataChannel.current);

  // Main UI
  if (!auth) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', justifyContent: 'center', background: darkMode ? 'linear-gradient(135deg, #232526 0%, #414345 100%)' : 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)' }}>
          <Paper elevation={6} sx={{ p: 4, borderRadius: 4, minWidth: 340 }}>
            <Box display="flex" flexDirection="column" alignItems="center" mb={3}>
              <Avatar src={logo} sx={{ width: 64, height: 64, mb: 1 }} />
              <Typography variant="h4" fontWeight={700} gutterBottom>ShareBuddy</Typography>
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
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', background: darkMode ? 'linear-gradient(135deg, #232526 0%, #414345 100%)' : 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)' }}>
        <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-end', p: 2 }}>
          <FormControlLabel
            control={<Switch checked={darkMode} onChange={() => setDarkMode(!darkMode)} />}
            label={darkMode ? 'Dark Mode' : 'Light Mode'}
          />
        </Box>
        <Paper elevation={6} sx={{ p: 4, mt: 6, borderRadius: 4 }}>
          <Box display="flex" flexDirection="column" alignItems="center" mb={3}>
            <Avatar src={logo} sx={{ width: 64, height: 64, mb: 1 }} />
            <Typography variant="h4" fontWeight={700} gutterBottom>ShareBuddy</Typography>
            <Typography variant="subtitle1" color="text.secondary" gutterBottom>
              Affordable, Secure, Peer-to-Peer Storage
            </Typography>
          </Box>
          {step === 'choose' && (
            <>
              <Typography align="center" mb={3}>
                Free up space or earn by sharing yours. Choose your role to get started:
              </Typography>
              <Grid container spacing={2} justifyContent="center">
                <Grid item xs={12} sm={6}>
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    size="large"
                    startIcon={<StorageIcon />}
                    onClick={() => { setRole('host'); setStep('host-wait'); }}
                  >
                    Offer Storage
                  </Button>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Button
                    fullWidth
                    variant="outlined"
                    color="primary"
                    size="large"
                    startIcon={<BackupIcon />}
                    onClick={() => { setRole('renter'); setStep('renter-wait'); }}
                  >
                    Need Storage
                  </Button>
                </Grid>
              </Grid>
            </>
          )}
          {role === 'host' && step === 'host-wait' && (
            <Box mt={3}>
              {!status && (
                <>
                  <Typography variant="h6" gutterBottom>Become a Storage Host</Typography>
                  <TextField
                    label="Available Space (GB)"
                    type="number"
                    value={storage}
                    onChange={e => setStorage(e.target.value)}
                    fullWidth
                    sx={{ mb: 2 }}
                  />
                  <Button
                    variant="contained"
                    color="primary"
                    fullWidth
                    onClick={goOnlineAsHost}
                    sx={{ mb: 2 }}
                    disabled={loading || !storage}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Go Online'}
                  </Button>
                  <Button fullWidth onClick={reset} color="secondary">Back</Button>
                </>
              )}
              {status && (
                <>
                  <Typography variant="h6" color="primary" gutterBottom>You are online as a host!</Typography>
                  <Typography color="text.secondary">Waiting for renters to connect...</Typography>
                  <Box mt={2}>
                    <Typography variant="subtitle2">Active Renters:</Typography>
                    <List>
                      {renters.length === 0 && <ListItem><ListItemText primary="No renters online yet." /></ListItem>}
                      {renters.map((r, i) => (
                        <ListItem key={r.id || i} divider>
                          <ListItemText primary={r.filename ? `${r.filename} (${r.size} bytes)` : `Renter #${i + 1}`} />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                  <Button fullWidth onClick={reset} color="secondary" sx={{ mt: 2 }}>Go Offline</Button>
                </>
              )}
            </Box>
          )}
          {role === 'renter' && step === 'renter-wait' && (
            <Box mt={3}>
              {!status && (
                <>
                  <Typography variant="h6" gutterBottom>Need Extra Storage?</Typography>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<CloudUploadIcon />}
                    fullWidth
                    sx={{ mb: 2 }}
                  >
                    {file ? file.name : 'Upload File'}
                    <input type="file" hidden onChange={handleFileChange} />
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    fullWidth
                    disabled={!file || loading}
                    onClick={findStorage}
                    sx={{ mb: 2 }}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Find Storage'}
                  </Button>
                  <Button fullWidth onClick={reset} color="secondary">Back</Button>
                </>
              )}
              {status && (
                <>
                  <Typography variant="h6" color="primary" gutterBottom>{status}</Typography>
                  <Box mt={2}>
                    <Typography variant="subtitle2">Nearby Hosts:</Typography>
                    <List>
                      {hosts.length === 0 && <ListItem><ListItemText primary="No hosts nearby." /></ListItem>}
                      {hosts.map((h, i) => (
                        <ListItem key={h.id || i} divider button selected={selectedHost?.socket_id === h.socket_id} onClick={() => connectToHost(h)}>
                          <ListItemText primary={`Host #${i + 1} (${h.storage} GB)`} secondary={`Distance: ${h.distance ? h.distance.toFixed(2) : '?'} km`} />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                  {selectedHost && (
                    <Button
                      variant="contained"
                      color="primary"
                      fullWidth
                      disabled={!file || loading}
                      onClick={uploadFileToHost}
                      sx={{ mt: 2 }}
                    >
                      {loading ? <CircularProgress size={24} /> : 'Upload to Selected Host'}
                    </Button>
                  )}
                  <Button fullWidth onClick={reset} color="secondary" sx={{ mt: 2 }}>Cancel</Button>
                </>
              )}
            </Box>
          )}
          {step === 'transfer' && (
            <Box mt={3}>
              <Typography variant="h6" color="primary" gutterBottom>Transferring File...</Typography>
              <Typography color="text.secondary">{transferMsg}</Typography>
              <Box mt={2}>
                <CircularProgress variant="determinate" value={progress} />
                <Typography mt={1}>{progress}%</Typography>
              </Box>
              <Button fullWidth onClick={reset} color="secondary" sx={{ mt: 2 }}>Cancel</Button>
            </Box>
          )}
          {step === 'done' && (
            <Box mt={3}>
              <Typography variant="h6" color="primary" gutterBottom>Transfer Complete!</Typography>
              <Typography color="text.secondary">File transfer finished successfully.</Typography>
              {receivedFile && (
                <Button
                  variant="outlined"
                  color="primary"
                  sx={{ mt: 2 }}
                  href={URL.createObjectURL(receivedFile)}
                  download={file?.name || 'received_file'}
                >
                  Download Received File
                </Button>
              )}
              <Button fullWidth onClick={reset} color="secondary" sx={{ mt: 2 }}>Back to Home</Button>
            </Box>
          )}
          {bothFlowsAvailable && (
            <Box mb={2}>
              <Typography color="warning.main">
                Warning: Both server upload and peer-to-peer transfer are available. Please use only one method to avoid confusion.
              </Typography>
            </Box>
          )}
          <Dialog open={showDialog} onClose={() => respondToRequest(false)}>
            <DialogTitle>Incoming Connection Request</DialogTitle>
            <DialogContent>
              <Typography>Renter wants to store: <b>{connRequest?.filename}</b> ({connRequest?.size} bytes)</Typography>
              <Typography>Do you want to accept?</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => respondToRequest(false)} color="secondary">Decline</Button>
              <Button onClick={() => respondToRequest(true)} color="primary" autoFocus>Accept</Button>
            </DialogActions>
          </Dialog>
        </Paper>
        <Box mt={4} textAlign="center">
          <Typography variant="caption" color="text.secondary">
            &copy; {new Date().getFullYear()} ShareBuddy. All rights reserved.
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default App;
