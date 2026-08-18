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
    private readonly sessions: SessionsService,
  ) {}

  async getDocument(key: string): Promise<AppDocument> {
    const doc = await this.documents.findOneBy({ key });
    if (!doc) throw new NotFoundException(`No document published for "${key}"`);
    return doc;
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

    // Participation, not registration: a delegate must have been in at least one
    // session while it was live. Checked only before the first issue - once a
    // certificate exists it stays valid regardless.
    if (!(await this.sessions.hasAttended(delegateId))) {
      throw new ForbiddenException(
        'Attend a session to earn your certificate of participation',
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
