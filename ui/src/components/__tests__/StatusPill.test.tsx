import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { StatusPill } from '../StatusPill';

describe('StatusPill', () => {
  it('keeps the server status visible to an operator', () => {
    renderWithProviders(<StatusPill status="waiting_review" />);

    expect(screen.getByText('waiting_review')).toBeInTheDocument();
  });
});
