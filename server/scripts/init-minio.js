const { S3Client, CreateBucketCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');

async function initializeMinio() {
    const client = new S3Client({
        region: process.env.S3_REGION || 'us-east-1',
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY,
        },
        forcePathStyle: true,
    });

    const bucketName = process.env.S3_BUCKET || 'sharebuddy';

    try {
        // Create bucket if it doesn't exist
        await client.send(new CreateBucketCommand({
            Bucket: bucketName
        }));
        console.log(`Bucket ${bucketName} created successfully`);

        // Set bucket policy
        const bucketPolicy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Sid: 'PublicRead',
                    Effect: 'Allow',
                    Principal: '*',
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${bucketName}/*`]
                }
            ]
        };

        await client.send(new PutBucketPolicyCommand({
            Bucket: bucketName,
            Policy: JSON.stringify(bucketPolicy)
        }));
        console.log('Bucket policy set successfully');

    } catch (error) {
        if (error.name === 'BucketAlreadyExists') {
            console.log(`Bucket ${bucketName} already exists`);
        } else {
            console.error('Error initializing MinIO:', error);
            throw error;
        }
    }
}

if (require.main === module) {
    initializeMinio().catch(console.error);
}

module.exports = initializeMinio; 