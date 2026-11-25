// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert, EmptyState, Progress, SegmentBar, Skeleton, SkeletonText } from './feedback';

afterEach(cleanup);

describe('Alert', () => {
  it('is a status for information and an alert for warnings, with title and body', () => {
    const { rerender } = render(<Alert title="Saved">All changes are saved.</Alert>);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Saved');
    expect(status.textContent).toContain('All changes are saved.');
    rerender(<Alert tone="warning">Feed is late</Alert>);
    expect(screen.getByRole('alert').textContent).toContain('Feed is late');
  });

  it('has a dismiss button when asked', () => {
    const onDismiss = vi.fn();
    render(
      <Alert tone="danger" onDismiss={onDismiss} action={<button type="button">Retry</button>}>
        Failed
      </Alert>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState', () => {
  it('shows the title as a heading of the given level, and is an alert in the danger tone', () => {
    render(<EmptyState title="Nothing here" headingLevel={2} description="Add a rule." tone="danger" action={<button type="button">Add</button>} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Add a rule.');
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });
});

describe('Skeleton', () => {
  it('announces loading only when asked', () => {
    const { rerender, container } = render(<Skeleton />);
    expect(container.textContent).toBe('');
    rerender(<SkeletonText lines={2} announce />);
    expect(screen.getByText('Loading')).toBeTruthy();
  });
});

describe('Progress', () => {
  it('is a progressbar named by its label with the value as text', () => {
    render(<Progress label="Used" value={30} max={60} showValue />);
    const bar = screen.getByRole('progressbar', { name: 'Used' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuemax')).toBe('60');
    expect(bar.getAttribute('aria-valuetext')).toBe('50%');
    expect(screen.getByText('50%')).toBeTruthy();
  });
});

describe('SegmentBar', () => {
  it('reads out every share', () => {
    render(
      <SegmentBar
        segments={[
          { value: 3, label: 'Field' },
          { value: 1, label: 'Remote' },
        ]}
      />,
    );
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Field 75%, Remote 25%');
  });
});
