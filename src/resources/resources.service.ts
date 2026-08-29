import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { SessionsService } from '../sessions/sessions.service';
import { StorageService } from '../common/storage/storage.service';
import { ParticipationService } from './participation.service';
import { AppDocument } from './entities/app-document.entity';
import { Certificate } from './entities/certificate.entity';
import { UpsertDocumentDto } from './dto/upsert-document.dto';
import { renderCertificatePdf } from './certificate-pdf';

export const PURPLE_BOOK_KEY = 'purple-book';

@Injectable()
export class ResourcesService {
  constructor(
    @InjectRepository(AppDocument)
    private readonly documents: Repository<AppDocument>,
    @InjectRepository(Certificate)
    private readonly certificates: Repository<Certificate>,
    private readonly storage: StorageService,
    private readonly participation: ParticipationService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * The stored `url` is an S3 key for anything uploaded through the admin, and
   * the bucket blocks public access - so it is signed on read, exactly like a
   * delegate photo. A genuinely external URL (someone pasted a link to a file
   * hosted elsewhere) is passed through untouched.
   */
  async getDocument(key: string): Promise<AppDocument> {
    const doc = await this.documents.findOneBy({ key });
    if (!doc) throw new NotFoundException(`No document published for "${key}"`);
    const url = await this.storage.resolveStoredUrl(doc.url);
    return { ...doc, url: url ?? doc.url };
  }

  upsertDocument(key: string, dto: UpsertDocumentDto): Promise<AppDocument> {
    return this.documents.save({
      key,
      title: dto.title,
      url: dto.url,
      sizeLabel: dto.sizeLabel ?? null,
    });
  }

  presignDocument(contentType: string) {
    return this.storage.presignUpload({ folder: 'documents', contentType });
  }

  // Human-readable and unambiguous when read aloud or typed from a printout:
  // no vowels (so no accidental words) and no 0/O/1/I lookalikes.
  private static newCode(): string {
    const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
    const bytes = randomBytes(10);
    const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join(
      '',
    );
    return `GS26-${body.slice(0, 5)}-${body.slice(5, 10)}`;
  }

  // Issue-once: a second call returns the delegate's existing certificate rather
  // than minting a new code, so the one they screenshotted stays valid.
  async issueCertificate(
    delegateId: string,
    delegateName: string,
  ): Promise<Certificate> {
    const existing = await this.certificates.findOneBy({ delegateId });
    if (existing) return existing;

    /**
     * Participation, not registration - and now the full checklist rather than
     * attendance alone. A certificate that says "participation" should require
     * having participated: joined a session, played the trivia, backed a pitch,
     * met people, said something.
     *
     * Checked only before the first issue. Once a certificate exists it stays
     * valid regardless, so a delegate can never lose one they earned.
     */
    const participation = await this.participation.statusFor(delegateId);
    if (!participation.unlocked) {
      const remaining = participation.steps
        .filter((s) => !s.done)
        .map((s) => s.label)
        .join('; ');
      throw new ForbiddenException(
        `Complete your summit participation to unlock your certificate. Still to do: ${remaining}`,
      );
    }

    return this.certificates.save(
      this.certificates.create({
        delegateId,
        delegateName,
        code: ResourcesService.newCode(),
      }),
    );
  }

  // Public check. Deliberately returns only what a verifier needs - the holder's
  // name and when it was issued - and never the delegate id or contact details.
  async verifyCertificate(
    code: string,
  ): Promise<{ valid: boolean; delegateName?: string; issuedAt?: Date }> {
    const cert = await this.certificates.findOneBy({
      code: code.toUpperCase(),
    });
    if (!cert) return { valid: false };
    return {
      valid: true,
      delegateName: cert.delegateName,
      issuedAt: cert.issuedAt,
    };
  }

  // The PDF is rendered on demand rather than stored: it is derived entirely
  // from the certificate row, so there is nothing to keep in sync or clean up.
  async certificatePdf(
    delegateId: string,
    delegateName: string,
  ): Promise<Buffer> {
    const cert = await this.issueCertificate(delegateId, delegateName);
    return renderCertificatePdf(cert);
  }
}
