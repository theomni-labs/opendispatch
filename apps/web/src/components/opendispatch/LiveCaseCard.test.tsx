// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveCaseCard } from './LiveCaseCard';
import { hasArabicIndicDigits, hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('LiveCaseCard (slim)', () => {
  it('shows a waiting case: number, time, zone, the wait, over 10 min, and the would-pick agent', () => {
    inLocale(
      'en',
      <LiveCaseCard
        caseId="c1"
        caseNumber="RD-260913-00238"
        time="10:33"
        zone="RD-S"
        waitMinutes={9}
        overReach
        pick={{ name: 'Hala Al-Rasahi', label: 'opendispatch_would_pick' }}
        eta={{ kind: 'travel', minutes: 12 }}
      />,
    );
    expect(screen.getByText('RD-260913-00238')).toBeTruthy();
    expect(screen.getByText('10:33')).toBeTruthy();
    expect(screen.getByText('RD-S')).toBeTruthy();
    expect(screen.getByText('Waiting 9 min')).toBeTruthy();
    expect(screen.getByText('Over 10 min')).toBeTruthy();
    expect(screen.getByText('Hala Al-Rasahi')).toBeTruthy();
    // Slim: no travel line, no Accept or Override
    expect(screen.queryByText(/travel/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Accept|Override/ })).toBeNull();
  });

  it('names the would-pick agent in a tooltip', () => {
    vi.useFakeTimers();
    inLocale('en', <LiveCaseCard caseId="c1" caseNumber="RD-1" time="10:00" zone="RD-S" waitMinutes={3} pick={{ name: 'Sara Al-Habuli', label: 'opendispatch_would_pick' }} />);
    fireEvent.mouseOver(screen.getByText('Sara Al-Habuli'));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('tooltip').textContent).toBe('OpenDispatch would pick');
  });

  it('shows a recommended case with its ETA, Accept and Override, which call back when pressed', () => {
    const onAccept = vi.fn();
    const onOverride = vi.fn();
    const onOpen = vi.fn();
    inLocale(
      'en',
      <LiveCaseCard
        caseId="c2"
        caseNumber="RD-260913-00245"
        time="10:42"
        zone="RD-N"
        pick={{ name: 'Reem Al-Jumiri', label: 'opendispatch_pick' }}
        eta={{ kind: 'eta', time: '10:46' }}
        onOpen={onOpen}
        onAccept={onAccept}
        onOverride={onOverride}
      />,
    );
    expect(screen.getByText('ETA 10:46')).toBeTruthy();
    expect(screen.getByText('Reem Al-Jumiri')).toBeTruthy();
    expect(screen.getByText('OpenDispatch pick')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Override/ }));
    expect(onOverride).toHaveBeenCalledTimes(1);
    // The buttons act alone: they never open the case
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('says the pick is outside the reader\'s zones, with no empty avatar, when its name cannot be read', () => {
    const { container } = inLocale('en', <LiveCaseCard caseId="c7" caseNumber="RD-7" time="10:42" zone="RD-N" pick={{ name: null, label: 'opendispatch_pick' }} eta={{ kind: 'eta', time: '10:46' }} />);
    expect(container.querySelector('[data-pick-unknown]')?.textContent).toBe('Agent outside your zones');
    expect(screen.queryByText('—')).toBeNull();
    expect(container.querySelectorAll('[data-pick-unknown] ~ *, [data-pick-unknown] + *')).toHaveLength(0);
  });

  it('opens the case from a click on the card or from the case number button', () => {
    const onOpen = vi.fn();
    const { container } = inLocale('en', <LiveCaseCard caseId="c3" caseNumber="RD-3" time="10:00" zone="RD-C" progress="enroute" pick={{ name: 'Fahad Al-Jumiri', source: 'opendispatch' }} onOpen={onOpen} />);
    fireEvent.click(container.querySelector('article') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Open case RD-3' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('shows the in-progress state as a tag, with the ETA or the arrival time', () => {
    const { rerender } = inLocale('en', <LiveCaseCard caseId="c4" caseNumber="RD-4" time="10:35" zone="RD-E" progress="assigned" pick={{ name: 'Majid Al-Kalari', source: 'customer' }} eta={{ kind: 'eta', time: '10:55' }} />);
    expect(screen.getByText('Assigned')).toBeTruthy();
    expect(screen.getByText('ETA 10:55')).toBeTruthy();
    rerender(<LiveCaseCard caseId="c4" caseNumber="RD-4" time="10:35" zone="RD-E" progress="onscene" pick={{ name: 'Fahad Al-Salati', source: 'customer' }} eta={{ kind: 'arrived', time: '10:41' }} />);
    expect(screen.getByText('On scene')).toBeTruthy();
    expect(screen.getByText('Arrived 10:41')).toBeTruthy();
  });

  it('shows the fallback source on the card when operator dispatch took the case', () => {
    inLocale('en', <LiveCaseCard caseId="c6" caseNumber="RD-6" time="10:44" zone="RD-W" progress="assigned" pick={{ name: 'Yousef Al-Salati', source: 'fallback' }} />);
    expect(screen.getByText('Fallback')).toBeTruthy();
  });

  it('gates Accept with a reason when the role cannot decide, and never calls the handler', () => {
    const onAccept = vi.fn();
    inLocale('en', <LiveCaseCard caseId="c2" caseNumber="RD-2" time="10:42" zone="RD-N" pick={{ name: 'Reem Al-Jumiri', label: 'opendispatch_pick' }} onAccept={onAccept} acceptDisabledReason="View only for this role" />);
    const accept = screen.getByRole('button', { name: /Accept/ });
    expect(accept.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(accept);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('renders Arabic: translated text, Western digits, codes and names left alone', () => {
    const { container } = inLocale(
      'ar',
      <LiveCaseCard caseId="c1" caseNumber="RD-260913-00238" time="10:33" zone="RD-S" waitMinutes={9} pick={{ name: 'هالة الرصاحي', label: 'opendispatch_would_pick' }} />,
    );
    expect(screen.getByText('بالانتظار 9 د')).toBeTruthy();
    expect(hasArabicIndicDigits(readableText(container))).toBe(false);
    expect(hasLatinLetters(readableText(container), ['RD-260913-00238', 'RD-S'])).toBe(false);
  });
});
