import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@emis/contracts';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

const MIN_SCORE = 3; // zxcvbn 0–4; 3 = "safely unguessable" for online attacks

/**
 * NIST 800-63B style: length over composition rules, and reject passwords that are common,
 * patterned or built from the person's own details. No forced character classes, no expiry.
 */
export class PasswordPolicy {
  private readonly zxcvbn = new ZxcvbnFactory({
    translations: zxcvbnEn.translations,
    graphs: zxcvbnCommon.adjacencyGraphs,
    dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
  });

  check(password: string, personalInputs: readonly string[] = []): PasswordCheck {
    if (password.length < PASSWORD_MIN_LENGTH) {
      return { ok: false, reason: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      return { ok: false, reason: `Use at most ${PASSWORD_MAX_LENGTH} characters.` };
    }

    const inputs = personalInputs
      .flatMap((input) => [input, ...input.split(/[@.\s_-]+/)])
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length >= 4);
    const lowered = password.toLowerCase();
    if (inputs.some((part) => lowered.includes(part))) {
      return { ok: false, reason: "Don't use your name or email address in your password." };
    }

    const result = this.zxcvbn.check(password, inputs);
    if (result.score < MIN_SCORE) {
      const hint = result.feedback.warning ?? result.feedback.suggestions[0];
      return { ok: false, reason: hint ? `Too easy to guess. ${hint}` : 'Too easy to guess.' };
    }
    return { ok: true };
  }
}
