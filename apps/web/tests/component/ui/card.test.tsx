import { describe, expect, it } from 'vitest';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { render, screen } from '../../helpers/render';

describe('CardHeader primitive', () => {
  describe('plain usage', () => {
    it('renders title and description in a vertical stack', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Trendyol Ana Mağaza</CardTitle>
            <CardDescription>Son senkron: 3 dk önce</CardDescription>
          </CardHeader>
          <CardContent>İçerik</CardContent>
        </Card>,
      );
      expect(screen.getByText('Trendyol Ana Mağaza')).toBeInTheDocument();
      expect(screen.getByText('Son senkron: 3 dk önce')).toBeInTheDocument();
    });
  });

  describe('leadingIcon prop', () => {
    it('renders the leading icon alongside the title', () => {
      render(
        <Card>
          <CardHeader leadingIcon={<svg data-testid="lead" aria-hidden="true" />}>
            <CardTitle>Mağaza</CardTitle>
          </CardHeader>
        </Card>,
      );
      expect(screen.getByTestId('lead')).toBeInTheDocument();
      expect(screen.getByText('Mağaza')).toBeInTheDocument();
    });
  });

  describe('actions prop', () => {
    it('renders the actions slot on the right', () => {
      render(
        <Card>
          <CardHeader
            actions={
              <button type="button" data-testid="menu">
                Menu
              </button>
            }
          >
            <CardTitle>Mağaza</CardTitle>
          </CardHeader>
        </Card>,
      );
      expect(screen.getByTestId('menu')).toBeInTheDocument();
    });

    it('renders leadingIcon + title + actions together', () => {
      render(
        <Card>
          <CardHeader
            leadingIcon={<svg data-testid="lead" aria-hidden="true" />}
            actions={<span data-testid="actions">X</span>}
          >
            <CardTitle>Başlık</CardTitle>
            <CardDescription>Açıklama</CardDescription>
          </CardHeader>
        </Card>,
      );
      expect(screen.getByTestId('lead')).toBeInTheDocument();
      expect(screen.getByText('Başlık')).toBeInTheDocument();
      expect(screen.getByText('Açıklama')).toBeInTheDocument();
      expect(screen.getByTestId('actions')).toBeInTheDocument();
    });
  });
});
