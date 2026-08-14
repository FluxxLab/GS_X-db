import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET');
    // No credentials here on purpose: the SDK reads the EC2 instance role.
    this.client = new S3Client({ region: config.get('S3_REGION') ?? 'eu-west-2' });
  }

  /** A one-time permission slip for the client to PUT a file directly to S3. */
  async presignUpload(input: { folder: string; contentType: string }) {
    if (!this.bucket) throw new ServiceUnavailableException('Uploads are not configured');

    const key = `${input.folder}/${randomUUID()}`;
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.contentType }),
      { expiresIn: 300 }, // 5 min to start the upload
    );
    return {
      uploadUrl,
      key,
      publicUrl: `https://${this.bucket}.s3.${this.config.get('S3_REGION')}.amazonaws.com/${key}`,
    };
  }
}
