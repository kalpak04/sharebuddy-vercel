const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

class StorageService {
  constructor() {
    this.client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
      },
      forcePathStyle: true, // Required for MinIO
    });
    this.bucket = process.env.S3_BUCKET || 'sharebuddy';
  }

  async uploadFile(fileBuffer, originalName, contentType) {
    const fileKey = `${crypto.randomUUID()}-${originalName}`;
    
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: contentType,
    }));

    return fileKey;
  }

  async generateDownloadUrl(fileKey) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
    });

    // URL expires in 1 hour
    return await getSignedUrl(this.client, command, { expiresIn: 3600 });
  }

  async deleteFile(fileKey) {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
    }));
  }
}

module.exports = new StorageService(); 