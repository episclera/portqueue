import { COMMANDS, COMMANDS_BY_NAME } from './index';
import { CommandGroup } from './types';

describe('command registry', () => {
  it('exposes a lookup entry for every command', () => {
    expect(COMMANDS_BY_NAME.size).toBe(COMMANDS.length);
    for (const command of COMMANDS) {
      expect(COMMANDS_BY_NAME.get(command.name)).toBe(command);
    }
  });

  it('has unique command names', () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('assigns every command a known group and a summary', () => {
    const groups = new Set(Object.values(CommandGroup));
    for (const command of COMMANDS) {
      expect(groups.has(command.group)).toBe(true);
      expect(command.summary.length).toBeGreaterThan(0);
    }
  });

  it('marks only long-running commands persistent', () => {
    const persistent = COMMANDS.filter((c) => c.persistent).map((c) => c.name).sort();
    expect(persistent).toEqual(['dashboard', 'listen']);
  });
});
