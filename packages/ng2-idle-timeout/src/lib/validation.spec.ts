import { DEFAULT_SESSION_TIMEOUT_CONFIG } from './defaults';
import { validateConfig } from './validation';

describe('validateConfig syncMode support', () => {
  it('defaults syncMode to leader when omitted', () => {
    const result = validateConfig(undefined);

    expect(result.config.syncMode).toBe('leader');
    expect(result.issues.find(issue => issue.field === 'syncMode')).toBeUndefined();
  });

  it('accepts distributed syncMode and preserves value', () => {
    const result = validateConfig({ syncMode: 'distributed' });

    expect(result.config.syncMode).toBe('distributed');
    expect(result.issues.find(issue => issue.field === 'syncMode')).toBeUndefined();
  });

  it('flags invalid syncMode values and falls back to default', () => {
    const result = validateConfig({ syncMode: 'invalid-mode' as never });

    const syncModeIssue = result.issues.find(issue => issue.field === 'syncMode');
    expect(syncModeIssue).toBeDefined();
    expect(syncModeIssue?.message).toContain('invalid-mode');
    expect(result.config.syncMode).toBe(DEFAULT_SESSION_TIMEOUT_CONFIG.syncMode);
  });
});
