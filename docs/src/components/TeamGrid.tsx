import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './TeamGrid.module.css';

type Member = {
  name: string;
  role: string;
  bio: string;
  initials: string;
  links: { label: string; href: string }[];
};

// Data-driven so contributors can be appended later. Only the lead is listed now.
const team: Member[] = [
  {
    name: 'Gheorghe Gherciu',
    role: 'Creator & Lead Engineer',
    bio: 'Designed and built PortQueue — the driver model, the public API, and the docs and dashboard design system.',
    initials: 'GG',
    links: [{ label: 'GitHub', href: 'https://github.com/episclera' }],
  },
];

/** `centered` lays the cards out from the middle (home page) instead of filling the row from the left. */
export function TeamGrid({ centered = false }: { centered?: boolean }): ReactNode {
  return (
    <div className={clsx(styles.grid, centered && styles.centered)}>
      {team.map((m) => (
        <div key={m.name} className={styles.card}>
          <div className={styles.avatar} aria-hidden>
            {m.initials}
          </div>
          <div className={styles.name}>{m.name}</div>
          <div className={styles.role}>{m.role}</div>
          <p className={styles.bio}>{m.bio}</p>
          <div className={styles.links}>
            {m.links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
