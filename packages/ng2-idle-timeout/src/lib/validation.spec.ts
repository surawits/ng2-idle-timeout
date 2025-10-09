import { validateConfig } from './validation';

describe('validateConfig legacy syncMode handling', () => {
  it('ignores legacy syncMode entries and surfaces a validation issue', () => {
    const result = validateConfig({ syncMode: 'distributed' } as unknown as Record<string, unknown>);

    expect(result.issues.find(issue => issue.field === 'syncMode')).toBeDefined();
    expect((result.config as Record<string, unknown>).syncMode).toBeUndefined();
  });

  it('does not report an issue when syncMode is omitted', () => {
    const result = validateConfig(undefined);

    expect(result.issues.find(issue => issue.field === 'syncMode')).toBeUndefined();
  });
});
