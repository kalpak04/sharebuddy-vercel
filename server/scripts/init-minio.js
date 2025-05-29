const { S3Client, CreateBucketCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function initializeMinIO() {
  const s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY
    },
    forcePathStyle: true
  });

  try {
    // Create bucket
    await s3Client.send(new CreateBucketCommand({
      Bucket: process.env.S3_BUCKET || 'sharebuddy'
    }));
    console.log('Bucket created successfully');

    // Set bucket policy
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicRead',
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${process.env.S3_BUCKET}/*`]
        }
      ]
    };

    await s3Client.send(new PutBucketPolicyCommand({
      Bucket: process.env.S3_BUCKET || 'sharebuddy',
      Policy: JSON.stringify(bucketPolicy)
    }));
    console.log('Bucket policy set successfully');

  } catch (error) {
    if (error.name === 'BucketAlreadyExists') {
      console.log('Bucket already exists, skipping creation');
    } else {
      console.error('Error initializing MinIO:', error);
      process.exit(1);
    }
  }
}

initializeMinIO(); 