// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../provider';
import { Badge, CountBadge, StatusPill, Tag } from './badge';

afterEach(cleanup);

describe('badges and tags', () => {
  it('shows the status text with a hidden dot', () => {
    const { container } = render(<StatusPill status="On shift" tone="success" />);
    expect(screen.getByText('On shift')).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.textContent).toBe('On shift');
  });

  it('writes a badge with its icon hidden', () => {
    const { container } = render(
      <Badge tone="danger" variant="solid" icon={<svg />}>
        Late
      </Badge>,
    );
    expect(container.textContent).toBe('Late');
  });

  it('caps a count', () => {
    render(<CountBadge count={120} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('has a real remove button named after the tag, in the provider language', () => {
    const onRemove = vi.fn();
    render(
      <DesignSystemProvider labels={{ 'tag.remove': 'Drop {name}' }}>
        <Tag color="gold" onRemove={onRemove}>
          Ramadan
        </Tag>
      </DesignSystemProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Drop Ramadan' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
