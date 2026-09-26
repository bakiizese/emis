import { describe, expect, it } from 'vitest';

import { GotenbergRenderer } from './pdf-renderer.js';

describe('GotenbergRenderer', () => {
  it('reports the PDF service as unavailable when it cannot be reached, without leaking details', async () => {
    const renderer = new GotenbergRenderer('http://127.0.0.1:1', 2_000);
    await expect(renderer.render('<!doctype html><html></html>')).rejects.toMatchObject({
      status: 503,
      response: { code: 'PDF_UNAVAILABLE' },
    });
  });
});
