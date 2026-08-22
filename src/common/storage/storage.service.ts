import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string | undefined;
  /**
   * Read once and shared. Signing against one region while building the public
   * URL for another produces a presigned URL S3 answers with 404 NoSuchBucket,
   * and a stored avatar URL pointing at a host that does not exist - both
   * silent, and neither traceable to a config default.
   */
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET');
    this.region = config.get<string>('S3_REGION') ?? 'eu-west-2';
    // No credentials here on purpose: the SDK reads the EC2 instance role.
    this.client = new S3Client({ region: this.region });
  }

  /** A one-time permission slip for the client to PUT a file directly to S3. */
  async presignUpload(input: { folder: string; contentType: string }) {
    if (!this.bucket)
      throw new ServiceUnavailableException('Uploads are not configured');

    const key = `${input.folder}/${randomUUID()}`;
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: input.contentType,
      }),
      { expiresIn: 300 }, // 5 min to start the upload
    );
    return { uploadUrl, key };
  }

  /**
   * A time-limited URL to read one object.
   *
   * The bucket has Block Public Access on, so there is no public URL to store -
   * a bare S3 URL would 403 on every render. Delegate photographs are not
   * something to leave world-readable at this event regardless of how
   * unguessable the key is: press and advocacy attendees are in this directory.
   *
   * What gets persisted on the delegate is therefore the *key*, and a fresh
   * signed URL is minted whenever the record is read. Signing is local HMAC -
   * no network call - so doing it per row in a directory listing is cheap.
   *
   * The 45 minute default is bounded by the credentials, not by choice. These
   * URLs are signed with the EC2 instance role's *temporary* credentials, and
   * S3 rejects a presigned URL once the credentials behind it expire - so any
   * expiry beyond the role's session duration (currently 1 hour on gs26-ssm) is
   * a promise the URL cannot keep. Raising it means raising the role's session
   * duration first, or signing with a long-lived principal instead.
   */
  presignRead(key: string, expiresIn = 45 * 60): Promise<string> {
    if (!this.bucket)
      throw new ServiceUnavailableException('Uploads are not configured');
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  /**
   * Resolves whatever is stored on a record into something the app can render.
   *
   * Tolerates both shapes: a key (what is written from now on) and a full URL
   * (anything stored earlier, or an external avatar), so this can ship without
   * a data migration. Returns null rather than throwing - a broken avatar must
   * never take down a profile or a directory page.
   */
  async resolveAvatar(
    stored: string | null | undefined,
  ): Promise<string | null> {
    if (!stored) return null;

    /**
     * A URL pointing at our own bucket has to be turned back into a key and
     * signed, not passed through. Older clients saved the public URL this
     * service used to hand out, and with Block Public Access on that URL 403s
     * forever - so trusting "it starts with https" would leave every avatar
     * uploaded before the switch permanently broken, with no error anywhere.
     */
    const ownPrefix = this.bucket
      ? `https://${this.bucket}.s3.${this.region}.amazonaws.com/`
      : null;
    const key =
      ownPrefix && stored.startsWith(ownPrefix)
        ? stored.slice(ownPrefix.length)
        : stored.startsWith('http://') || stored.startsWith('https://')
          ? null // genuinely external - leave it alone
          : stored;

    if (key === null) return stored;
    if (!this.bucket) return null;
    try {
      return await this.presignRead(key);
    } catch {
      return null;
    }
  }
}
