import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from '@/features/campaigns/lib/download-blob';

const OBJECT_URL = 'blob:mock-download';
const FILENAME = 'indirim-listesi.xlsx';

interface AnchorClick {
  readonly anchor: HTMLAnchorElement;
  readonly download: string;
  readonly href: string | null;
  readonly attached: boolean;
}

describe('downloadBlob', () => {
  const clicks: AnchorClick[] = [];

  beforeEach(() => {
    clicks.length = 0;
    vi.useFakeTimers();
    // happy-dom cannot read a Blob through an object URL; both URL calls are stubbed.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(OBJECT_URL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({
        anchor: this,
        download: this.download,
        href: this.getAttribute('href'),
        attached: this.isConnected,
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clicks an attached anchor named after the file, removes it, and revokes the URL only on a later task', () => {
    downloadBlob(new Blob(['xlsx']), FILENAME);

    expect(clicks).toHaveLength(1);
    const click = clicks[0];
    expect(click).toBeDefined();
    if (click === undefined) return;
    expect(click.download).toBe(FILENAME);
    expect(click.href).toBe(OBJECT_URL);
    expect(click.attached).toBe(true);
    expect(click.anchor.isConnected).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });
});
