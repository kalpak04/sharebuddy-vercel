const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

class StorageService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY
      }
    });
    this.bucket = process.env.S3_BUCKET;
  }

  async generateUploadUrl(fileName, fileType, userId, hostId) {
    try {
      const fileKey = `${userId}/${hostId}/${crypto.randomUUID()}-${fileName}`;
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
        ContentType: fileType,
        Metadata: {
          userId: userId.toString(),
          hostId: hostId.toString(),
          originalName: fileName
        }
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
      return { signedUrl, fileKey };
    } catch (error) {
      console.error('Error generating upload URL:', error);
      throw new Error('Failed to generate upload URL');
    }
  }

  async generateDownloadUrl(fileKey) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: fileKey
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    } catch (error) {
      console.error('Error generating download URL:', error);
      throw new Error('Failed to generate download URL');
    }
  }
}

module.exports = new StorageService(); 