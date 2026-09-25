import { describe, expect, it } from 'vitest';

import { escapeHtml, markup, raw, safeColor } from './html.js';

describe('markup', () => {
  it('escapes everything interpolated, so a name cannot inject markup', () => {
    const name = '<img src="http://169.254.169.254/latest/meta-data"> & "quotes" \'too\'';
    const out = markup`<p>${name}</p>`.value;
    expect(out).toBe(
      '<p>&lt;img src=&quot;http://169.254.169.254/latest/meta-data&quot;&gt; &amp; &quot;quotes&quot; &#39;too&#39;</p>',
    );
    expect(out).not.toContain('<img');
  });

  it('leaves generated markup alone and joins lists of it', () => {
    expect(markup`<b>${raw('<svg/>')}</b>`.value).toBe('<b><svg/></b>');
    const rows = ['a', 'b'].map((x) => markup`<li>${x}</li>`);
    expect(markup`<ul>${rows}</ul>`.value).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('shows nothing for null and keeps zero', () => {
    expect(markup`[${null}][${undefined}][${0}]`.value).toBe('[][][0]');
  });

  it('escapes on its own', () => {
    expect(escapeHtml('a<b>&')).toBe('a&lt;b&gt;&amp;');
  });
});

describe('safeColor', () => {
  it('only lets a plain hex colour into CSS', () => {
    expect(safeColor('#0f766e')).toBe('#0f766e');
    expect(safeColor('red; background:url(http://evil)')).toBe('#1d4ed8');
    expect(safeColor('#12345')).toBe('#1d4ed8');
  });
});
