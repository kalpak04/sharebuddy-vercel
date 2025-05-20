# ShareBuddy Host App (Electron)

## Setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the app in development mode:
   ```sh
   npm start
   ```
3. Build the app for production:
   ```sh
   npm run make
   ```

## Troubleshooting
- If the app fails to start, ensure you have the correct Node.js version (>=16).
- If file saving fails, check folder permissions and available disk space.
- If file transfer stalls, check:
  - Both host and renter are online and using the same backend.
  - TURN server is reachable (see ICE config in `HostDashboard.jsx`).
- For debugging, use the DevTools (View > Toggle Developer Tools).

## Security Notes
- Files are decrypted and saved only after validation (type/size/quota).
- For production, use a per-transfer encryption key and secure signaling.
- No host authentication by default; add as needed for your use case.
- Geolocation is only used for host discovery and is never stored precisely.

## Contributing
- PRs welcome! Please add tests and update documentation as needed. 