// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { setupDom } from '../helpers/dom';

describe('dom test environment', () => {
  it('mounts html into the global document', () => {
    const { document } = setupDom('<button id="x">hi</button>');

    expect(document.getElementById('x')).not.toBeNull();
    expect(document.getElementById('x').textContent).toBe('hi');
  });

  it('cleanup() restores the global document state', () => {
    const { document, cleanup } = setupDom('<button id="x">hi</button>');
    expect(document.getElementById('x')).not.toBeNull();

    cleanup();

    expect(document.getElementById('x')).toBeNull();
    expect(document.body.innerHTML).toBe('');
  });

  it('setupDom() without html starts from an empty body', () => {
    const { document } = setupDom();

    expect(document.body.innerHTML).toBe('');
  });
});
