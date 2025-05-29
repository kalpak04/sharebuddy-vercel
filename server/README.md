# ShareBuddy Backend (Signaling Server)

## Setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Configure your environment:
   - Create a `.env` file with the following configurations:
     ```env
     # Database Configuration (Option 1 - Recommended)
     DATABASE_URL=your_render_postgres_connection_string
     
     # Database Configuration (Option 2 - Alternative)
     PGHOST=your_host
     PGUSER=your_user
     PGPASSWORD=your_password
     PGDATABASE=your_database
     PGPORT=5432
     
     # Database Pool Configuration
     MAX_POOL_SIZE=20
     IDLE_TIMEOUT_MS=30000
     CONNECTION_TIMEOUT_MS=5000
     
     # Application Configuration
     NODE_ENV=production  # or development
     JWT_SECRET=your_secure_jwt_secret
     PORT=5000
     
     # Security Configuration
     CORS_ORIGIN=https://your-frontend-domain.com
     RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
     RATE_LIMIT_MAX_REQUESTS=1000
     ```

3. Start the server:
   ```sh
   npm start
   ```

## Architecture Overview

### Database Connection
- Uses connection pooling with configurable size and timeout settings
- Supports both connection string and individual credentials
- Implements graceful shutdown and health checks
- Automatic SSL handling for production environments

### Security Features
- JWT-based authentication
- Rate limiting for API endpoints
- CORS protection
- Helmet security headers
- Input validation and sanitization

### Monitoring & Health
- `/health` endpoint for system status
- Database connection monitoring
- Graceful shutdown handling
- Error logging and monitoring hooks

## Troubleshooting
- If you see CORS errors, ensure the CORS config matches your frontend URL
- If the server crashes, check your PostgreSQL connection and credentials
- For signaling issues, check logs for socket connection errors
- For periodic cleanup, see logs for stale host/renter removal
- Monitor the `/health` endpoint for system status

## Security Notes
- Store JWT_SECRET securely and rotate regularly
- Geolocation is only used for host discovery and is never stored precisely
- All signaling is over WebSocket (Socket.IO)
- Database credentials should be treated as sensitive information

## Contributing
- PRs welcome! Please add tests and update documentation as needed
- Follow the established error handling patterns
- Add monitoring hooks where appropriate
- Update environment variables documentation when adding new features