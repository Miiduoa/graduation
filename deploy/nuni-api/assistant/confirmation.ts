import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AssistantError } from './publicContext';
// Ephemeral process key: restart invalidates outstanding read-only confirmations.
const processKey = randomBytes(32);
export class Confirmations {
  constructor(
    private key: Uint8Array = processKey,
    private now = Date.now,
  ) {}
  sign(binding: object): string {
    const payload = Buffer.from(JSON.stringify({ binding, expires: this.now() + 300000 })).toString(
      'base64url',
    );
    return payload + '.' + this.mac(payload);
  }
  private mac(payload: string) {
    return createHmac('sha256', this.key)
      .update('campus-public-assistant:v1:' + payload)
      .digest('base64url');
  }
  verify(token: unknown, binding: object) {
    try {
      if (typeof token !== 'string' || token.length > 4096) throw 0;
      const [payload, signature, extra] = token.split('.');
      if (!payload) throw 0;
      const expected = this.mac(payload);
      if (
        extra ||
        !signature ||
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        throw 0;
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (
        parsed.expires <= this.now() ||
        parsed.expires > this.now() + 300000 ||
        JSON.stringify(parsed.binding) !== JSON.stringify(binding)
      )
        throw 0;
    } catch {
      throw new AssistantError('CONFIRMATION_INVALID', 409);
    }
  }
}
