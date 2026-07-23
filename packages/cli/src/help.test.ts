import { renderHelp } from './help';
import { COMMANDS } from './commands/index';

describe('renderHelp', () => {
  const help = renderHelp();

  it('lists every registered command by name', () => {
    for (const command of COMMANDS) {
      expect(help).toContain(command.name);
    }
  });

  it('includes each command summary', () => {
    for (const command of COMMANDS) {
      expect(help).toContain(command.summary);
    }
  });

  it('renders the group headings and global flags', () => {
    expect(help).toContain('Monitoring:');
    expect(help).toContain('Actions:');
    expect(help).toContain('Operational:');
    expect(help).toContain('Global flags:');
    expect(help).toContain('--json');
  });
});
