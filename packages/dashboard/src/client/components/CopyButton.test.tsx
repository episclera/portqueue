/**
 * The copy control's feedback contract. A copy that looks identical before and after leaves the
 * user unsure it worked, so pressing it must visibly confirm — and must say so when it fails,
 * rather than silently doing nothing on an insecure origin where there is no clipboard API.
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
// Under ts-jest's ESM mode there is no `jest` global; the timer controls come from here.
import { jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CopyButton, ThemeProvider } from '@portqueue/ui';

/** Install a clipboard that either resolves or rejects; returns the recorded writes. */
function stubClipboard(mode: 'ok' | 'reject' | 'absent'): string[] {
  const written: string[] = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value:
      mode === 'absent'
        ? undefined
        : {
            writeText: (text: string) => {
              if (mode === 'reject') return Promise.reject(new Error('denied'));
              written.push(text);
              return Promise.resolve();
            },
          },
  });
  return written;
}

const renderCopy = (): void => {
  render(
    <ThemeProvider mode="light">
      <CopyButton value="job-abcdef123456" label="job id" />
    </ThemeProvider>,
  );
};

/** Click and let the clipboard promise settle, so the state has actually moved on. */
const press = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button'));
  });
};

describe('CopyButton', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }));
  afterEach(() => {
    // Inside act(): a pending reset timer sets state, and flushing it bare warns.
    act(() => void jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  it('confirms the copy, then returns to resting after a second', async () => {
    const written = stubClipboard('ok');
    renderCopy();

    expect(screen.getByRole('button', { name: 'Copy job id' })).toBeInTheDocument();

    await press();

    expect(written).toEqual(['job-abcdef123456']);
    // Both the visible affordance and the announcement change — a colour swap alone is no
    // feedback to a screen-reader user.
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copied');

    act(() => void jest.advanceTimersByTime(1000));

    expect(screen.getByRole('button', { name: 'Copy job id' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('says so when there is no clipboard API, instead of looking like it worked', async () => {
    stubClipboard('absent');
    renderCopy();

    await press();

    // An insecure origin (a dashboard on plain HTTP) has no navigator.clipboard at all.
    expect(screen.getByRole('status')).toHaveTextContent(/Couldn't copy/);
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });

  it('says so when the write is rejected', async () => {
    stubClipboard('reject');
    renderCopy();

    await press();

    expect(screen.getByRole('status')).toHaveTextContent(/Couldn't copy/);
  });

  it('holds the confirmation for a full second when clicked twice in a row', async () => {
    stubClipboard('ok');
    renderCopy();

    await press();
    act(() => void jest.advanceTimersByTime(800));
    await press();

    // The second press restarts the window; the first press's timer must not cut it short.
    act(() => void jest.advanceTimersByTime(400));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    act(() => void jest.advanceTimersByTime(600));
    expect(screen.getByRole('button', { name: 'Copy job id' })).toBeInTheDocument();
  });
});
