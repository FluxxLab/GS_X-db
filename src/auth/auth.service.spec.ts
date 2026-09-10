import { AuthService } from './auth.service';

/**
 * forgotPassword is anti-enumeration by design: silent for an unknown email,
 * silent for a placeholder account too. The second case is new - a
 * placeholder's email is a guess at a public mailbox that may belong to a
 * real stranger, and a reset code must never reach it. That has to hold for
 * a row seeded under either marker: `hasChosenPassword` false, or - for a
 * row older than that column - the legacy `seed` tag.
 */
describe('AuthService.forgotPassword', () => {
  const build = (
    delegate: { hasChosenPassword: boolean; tags?: string[] } | null,
  ) => {
    const delegateService = {
      findByEmailForAuth: jest.fn().mockResolvedValue(delegate),
    };
    const otpService = { requestOtp: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      {} as any,
      {} as any,
      {} as any,
      delegateService as any,
      otpService as any,
      {} as any,
      {} as any,
    );
    return { service, otpService };
  };

  it('emails a code when the account set its own password', async () => {
    const { service, otpService } = build({ hasChosenPassword: true });
    await service.forgotPassword('real@example.com');
    expect(otpService.requestOtp).toHaveBeenCalledWith(
      'real@example.com',
      'email',
      undefined,
      'password reset',
    );
  });

  it('stays silent for a placeholder account', async () => {
    const { service, otpService } = build({ hasChosenPassword: false });
    await service.forgotPassword('placeholder@gmail.com');
    expect(otpService.requestOtp).not.toHaveBeenCalled();
  });

  it('stays silent for a row seeded before the column existed, tag only', async () => {
    const { service, otpService } = build({
      hasChosenPassword: true, // the column's default, since nothing back-fills it
      tags: ['seed'],
    });
    await service.forgotPassword('old-placeholder@gmail.com');
    expect(otpService.requestOtp).not.toHaveBeenCalled();
  });

  it('stays silent when no account matches, same as an unknown email', async () => {
    const { service, otpService } = build(null);
    await service.forgotPassword('nobody@example.com');
    expect(otpService.requestOtp).not.toHaveBeenCalled();
  });
});
