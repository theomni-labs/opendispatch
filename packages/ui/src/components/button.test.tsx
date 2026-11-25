// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider, type LinkComponentProps } from '../provider';
import { Button, IconButton } from './button';

afterEach(cleanup);

describe('Button', () => {
  it('is a real button of type button, named by its text, with icons hidden from the name', () => {
    const onClick = vi.fn();
    render(
      <Button startIcon={<svg data-testid="start" />} endIcon={<svg />} onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(screen.getByTestId('start').closest('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps a submit type and is disabled and busy while loading', () => {
    const onClick = vi.fn();
    render(
      <Button type="submit" loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button.getAttribute('type')).toBe('submit');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('renders the provider link for href, and a disabled button when disabled', () => {
    function RouterLink(props: LinkComponentProps) {
      return <a data-router="yes" {...props} />;
    }
    const { rerender } = render(
      <DesignSystemProvider linkComponent={RouterLink}>
        <Button href="/ops">Open</Button>
      </DesignSystemProvider>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.getAttribute('href')).toBe('/ops');
    expect(link.getAttribute('data-router')).toBe('yes');
    rerender(
      <DesignSystemProvider linkComponent={RouterLink}>
        <Button href="/ops" disabled>
          Open
        </Button>
      </DesignSystemProvider>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('IconButton', () => {
  it('is named by its label, also shown as the title', () => {
    render(<IconButton icon={<svg />} label="Close" aria-expanded={false} />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button.getAttribute('title')).toBe('Close');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('is a link with the label as its name when it has an href', () => {
    render(<IconButton icon={<svg />} label="Back" href="/home" />);
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/home');
  });
});
