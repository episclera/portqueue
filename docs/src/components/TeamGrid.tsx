import type { ReactNode } from 'react';
import styled from 'styled-components';

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
    role: 'Creator & Lead Developer',
    bio: 'Designed and built PortQueue — the driver model, the public API, and the docs and dashboard design system.',
    initials: 'GG',
    links: [{ label: 'GitHub', href: 'https://github.com/episclera' }],
  },
];

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1.25rem;
  margin: 2rem 0;
`;

const CardEl = styled.div`
  padding: 1.75rem 1.5rem;
  border-radius: 16px;
  text-align: center;
  background: var(--surface);
  border: 1px solid var(--secondary);
  box-shadow: var(--ifm-global-shadow-md);
`;

const Avatar = styled.div`
  width: 72px;
  height: 72px;
  margin: 0 auto 1rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 1.5rem;
  color: var(--text);
  background: linear-gradient(135deg, var(--primary-dark), var(--primary));
`;

const Name = styled.div`
  font-weight: 700;
  font-size: 1.15rem;
`;

const Role = styled.div`
  color: var(--ifm-color-primary);
  font-weight: 600;
  font-size: 0.9rem;
  margin-top: 0.15rem;
`;

const Bio = styled.p`
  font-size: 0.92rem;
  opacity: 0.8;
  margin: 0.75rem 0 1rem;
`;

const Links = styled.div`
  & a {
    font-weight: 600;
    font-size: 0.9rem;
  }
`;

export function TeamGrid(): ReactNode {
  return (
    <Grid>
      {team.map((m) => (
        <CardEl key={m.name}>
          <Avatar aria-hidden>{m.initials}</Avatar>
          <Name>{m.name}</Name>
          <Role>{m.role}</Role>
          <Bio>{m.bio}</Bio>
          <Links>
            {m.links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
            ))}
          </Links>
        </CardEl>
      ))}
    </Grid>
  );
}
