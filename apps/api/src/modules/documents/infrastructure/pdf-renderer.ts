import { Logger } from '@nestjs/common';

import { documentErrors } from '../domain/errors.js';

/** Turns a finished HTML page into PDF bytes. The page's CSS `@page` size is the paper size. */
export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
}

/** Injection token: `@Inject(PDF_RENDERER) renderer: PdfRenderer`. Tests swap in a fake. */
export const PDF_RENDERER = Symbol('PDF_RENDERER');

/**
 * Renders through Gotenberg (headless Chromium in its own container). It's only reachable from
 * the API's network and needs no internet: our pages are self-contained.
 */
export class GotenbergRenderer implements PdfRenderer {
  private readonly logger = new Logger(GotenbergRenderer.name);

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async render(html: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    form.append('preferCssPageSize', 'true');
    form.append('printBackground', 'true');

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/forms/chromium/convert/html`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.error(`Gotenberg unreachable: ${error instanceof Error ? error.name : 'error'}`);
      throw documentErrors.pdfUnavailable();
    }
    if (!response.ok) {
      this.logger.error(`Gotenberg answered ${response.status}`);
      throw documentErrors.pdfUnavailable();
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
