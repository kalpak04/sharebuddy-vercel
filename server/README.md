# ShareBuddy Backend (Signaling Server)

## Setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Set up your PostgreSQL database and update `.env` with connection details.
3. Start the server:
   ```sh
   npm start
   ```

## Troubleshooting
- If you see CORS errors, ensure the CORS config matches your frontend URL.
- If the server crashes, check your PostgreSQL connection and credentials.
- For signaling issues, check logs for socket connection errors.
- For periodic cleanup, see logs for stale host/renter removal.

## Security Notes
- No authentication by default; add as needed for your use case.
- Geolocation is only used for host discovery and is never stored precisely.
- All signaling is over WebSocket (Socket.IO).

## Contributing
- PRs welcome! Please add tests and update documentation as needed.