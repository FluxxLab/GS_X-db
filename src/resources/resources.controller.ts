import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AvatarUploadDto } from '../delegate/dto/avatar-upload.dto';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../auth/strategies/jwt.stategies';
import { DelegatesService } from '../delegate/delegates.service';
import type { Response } from 'express';
import { UpsertDocumentDto } from './dto/upsert-document.dto';
import { PURPLE_BOOK_KEY, ResourcesService } from './resources.service';
import { ParticipationService } from './participation.service';

@ApiTags('resources')
@ApiBearerAuth()
@Controller()
export class ResourcesController {
  constructor(
    private readonly service: ResourcesService,
    private readonly delegates: DelegatesService,
    private readonly participation: ParticipationService,
  ) {}

  // FR-15. Served from the database rather than a build-time constant so the
  // Purple Book can be republished without shipping a new app version.
  @Get('documents/purple-book')
  @ApiOperation({
    summary: 'The Purple Book: title, download URL and size label',
  })
  @ApiResponse({ status: 404, description: 'Not published yet' })
  purpleBook() {
    return this.service.getDocument(PURPLE_BOOK_KEY);
  }

  @Put('documents/purple-book')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Publish or replace the Purple Book' })
  setPurpleBook(@Body() dto: UpsertDocumentDto) {
    return this.service.upsertDocument(PURPLE_BOOK_KEY, dto);
  }

  @Post('documents/upload-url')
  @Roles(AccessTier.ADMIN)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Signed URL for a document: PUT the file, then send publicUrl to the document route',
  })
  documentUploadUrl(@Body() dto: AvatarUploadDto) {
    return this.service.presignDocument(dto.contentType);
  }

  /**
   * The participation checklist that unlocks the certificate.
   *
   * Separate from issuing so the app can show progress *before* a delegate is
   * eligible - a locked certificate with no explanation is just a dead end,
   * and the point of the checklist is to tell them what is still missing.
   */
  @Get('certificates/me/participation')
  @ApiOperation({
    summary: 'Participation checklist and whether the certificate is unlocked',
  })
  @ApiResponse({
    status: 200,
    description: 'Steps, progress and unlocked flag',
  })
  participationStatus(@CurrentUser() user: AuthUser) {
    return this.participation.statusFor(user.id);
  }

  // FR-16. Issued on first request rather than pre-generated for everyone, so a
  // certificate only exists for a delegate who actually asked for one.
  @Post('certificates/me')
  @HttpCode(200)
  @ApiOperation({
    summary: "Issue (or return) this delegate's certificate of participation",
  })
  async myCertificate(@CurrentUser() user: AuthUser) {
    const delegate = await this.delegates.getProfile(user.id);
    const cert = await this.service.issueCertificate(
      delegate.id,
      delegate.name,
    );
    return {
      code: cert.code,
      delegateName: cert.delegateName,
      issuedAt: cert.issuedAt,
    };
  }

  @Get('certificates/me.pdf')
  @ApiOperation({
    summary:
      'Download the certificate as a PDF. Issues it first if needed, so the same participation gate applies.',
  })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @ApiResponse({
    status: 403,
    description: 'Participation checklist not complete',
  })
  async certificatePdf(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const delegate = await this.delegates.getProfile(user.id);
    const pdf = await this.service.certificatePdf(delegate.id, delegate.name);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="gs26-certificate.pdf"',
    );
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  }

  @Public()
  @Get('certificates/verify/:code')
  @ApiOperation({
    summary:
      'Check a certificate code. Public: a verifier has the code, not an account',
  })
  verify(@Param('code') code: string) {
    return this.service.verifyCertificate(code);
  }
}
