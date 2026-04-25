import { describe, expect, it } from 'vitest';

import { BottomDock } from '@/components/patterns/bottom-dock';
import { render, screen } from '@/../tests/helpers/render';

describe('BottomDock', () => {
  it('renders children inside the dock', () => {
    render(
      <BottomDock>
        <button>Destek</button>
        <button>Ayarlar</button>
      </BottomDock>,
    );
    expect(screen.getByRole('button', { name: 'Destek' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ayarlar' })).toBeInTheDocument();
  });

  it('includes focusable elements naturally', () => {
    render(
      <BottomDock>
        <button>Destek</button>
        <button>Ayarlar</button>
      </BottomDock>,
    );
    const button = screen.getByRole('button', { name: 'Destek' });
    button.focus();
    expect(button).toHaveFocus();
  });

  it('renders BottomDock.Divider as an element with role="separator"', () => {
    render(
      <BottomDock>
        <button>Destek</button>
        <BottomDock.Divider />
        <button>Çıkış</button>
      </BottomDock>,
    );
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});
