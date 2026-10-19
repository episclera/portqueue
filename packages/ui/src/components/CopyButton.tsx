import React from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { Tooltip } from './Tooltip';
import { CheckIcon, CopyIcon } from '../icons';
import styles from './CopyButton.module.css';

export interface CopyButtonProps {
  /** The text placed on the clipboard. */
  value: string;
  /** What was copied, named for the tooltip and the screen-reader label: "job id". */
  label: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  /** Show the label beside the icon instead of an icon-only control. */
  showLabel?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** How long the confirmation holds before the button returns to its resting state. */
const CONFIRM_MS = 1000;

type State = 'idle' | 'copied' | 'failed';

const COPY: Record<State, (label: string) => string> = {
  idle: (label) => `Copy ${label}`,
  copied: () => 'Copied',
  failed: () => "Couldn't copy — press ⌘C",
};

/**
 * Copy-to-clipboard control that says whether it worked. Pressing it swaps the icon for a tick
 * for a second, so the click has a visible result — a copy that looks identical before and after
 * leaves the user pressing it again to be sure.
 *
 * The outcome is also announced: the state lives in a `role="status"` region, because a colour
 * change is no feedback at all to a screen-reader user.
 *
 * A failure is reported rather than swallowed. `navigator.clipboard` is undefined on an insecure
 * origin — a dashboard mounted on plain HTTP over a LAN is exactly that — and the write can be
 * rejected outright, so the button says to press ⌘C instead of silently doing nothing.
 */
export function CopyButton({
  value,
  label,
  size = 'sm',
  variant = 'text',
  showLabel = false,
  className,
  style,
}: CopyButtonProps): React.ReactElement {
  const [state, setState] = React.useState<State>('idle');
  const timer = React.useRef<ReturnType<typeof setTimeout>>();

  // A click landing while the tick is still up must not leave a stale timer to reset it early.
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (): Promise<void> => {
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), CONFIRM_MS);
  };

  const title = COPY[state](label);

  return (
    <Tooltip title={title} placement="bottom">
      <Button
        size={size}
        variant={variant}
        className={className}
        style={style}
        icon={state === 'copied' ? <CheckIcon className={styles.confirmed} /> : <CopyIcon />}
        onClick={() => void copy()}
        aria-label={title}
      >
        {showLabel ? (state === 'copied' ? 'Copied' : 'Copy') : null}
        {/* Announced on change; empty while idle so it stays silent until something happens. */}
        <span className={styles.visuallyHidden} role="status">
          {state === 'idle' ? '' : title}
        </span>
      </Button>
    </Tooltip>
  );
}
