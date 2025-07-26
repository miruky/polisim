import { describe, expect, it } from 'vitest';
import { isThemeChoice, nextChoice, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('systemはOSの設定に従う', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('明示指定はOSに関わらず固定する', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('nextChoice', () => {
  it('system -> light -> dark -> system と巡回する', () => {
    expect(nextChoice('system')).toBe('light');
    expect(nextChoice('light')).toBe('dark');
    expect(nextChoice('dark')).toBe('system');
  });
});

describe('isThemeChoice', () => {
  it('既知の値だけを受け入れる', () => {
    expect(isThemeChoice('dark')).toBe(true);
    expect(isThemeChoice('sepia')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });
});
