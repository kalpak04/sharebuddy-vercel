FROM minio/minio:latest

# Create default bucket directory
RUN mkdir -p /data/sharebuddy

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:9000/minio/health/live || exit 1

# Expose MinIO server and console ports
EXPOSE 9000
EXPOSE 9001

ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001", "--address", ":9000"]

# Set environment variables
#S3 access key
ENV MINIO_ROOT_USER=sharebuddy_admin
#S3 secret key
ENV MINIO_ROOT_PASSWORD=YourSecure123!Pass

# Configure MinIO to use less memory for free tier
ENV MINIO_CACHE_QUOTA=1
ENV MINIO_CACHE_AFTER=1
ENV MINIO_CACHE_WATERMARK_LOW=70
ENV MINIO_CACHE_WATERMARK_HIGH=80