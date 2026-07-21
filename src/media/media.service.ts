import { Injectable } from '@nestjs/common';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSignedUrl as getCloudfrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const ONE_MINUTE = 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;

@Injectable()
export class MediaService {
  private readonly s3Client = new S3Client(); // config is auto loaded from .env

  async createUploadUrl(fileType: string) {
    const uuid = uuidv4();
    const key = `uploads/${uuid}.${fileType}`;
    const url = await getS3SignedUrl(
      this.s3Client,
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME as string,
        Key: key,
        ContentType: `image/${fileType}`,
        CacheControl: 'max-age=31536000, immutable',
      }),
      { expiresIn: 5 * ONE_MINUTE },
    );
    return { url, key };
  }

  getPresignedViewUrl(key: string) {
    const url = getCloudfrontSignedUrl({
      url: `https://${process.env.CLOUDFRONT_DOMAIN}/${key}`,
      keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID as string,
      privateKey: process.env.CLOUDFRONT_PRIVATE_KEY as string,
      dateLessThan: new Date(Date.now() + ONE_DAY * 1000).toISOString(),
    });
    return { url };
  }
}
