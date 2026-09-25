import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s): the defaults every authenticator app supports. */
@Injectable()
export class TotpProvider {
  createSecret(): string {
    return generateSecret();
  }

  uri(secret: string, accountLabel: string, issuer: string): string {
    return generateURI({ issuer, label: accountLabel, secret });
  }

  qrCodeSvg(uri: string): Promise<string> {
    return QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  }

  /**
   * Returns the matched time step, or null. Accepts one step of clock drift either way and rejects
   * any step at or before `afterTimeStep`, so a code can't be replayed once used.
   */
  async verify(secret: string, code: string, afterTimeStep: number | null): Promise<number | null> {
    const result = await verify({
      secret,
      token: code,
      epochTolerance: 30,
      ...(afterTimeStep === null ? {} : { afterTimeStep }),
    });
    // The functional API types HOTP and TOTP results together; only TOTP results carry timeStep.
    return result.valid && 'timeStep' in result ? result.timeStep : null;
  }
}
