// テーマ選択の純粋ロジック。DOMやlocalStorageには触れず、状態を渡して使う。
// system はOSの prefers-color-scheme に従い、light/dark は明示的に固定する。

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

// トグルは system → light → dark → system と巡回する
export function nextChoice(choice: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? 'system';
}

export function choiceLabel(choice: ThemeChoice): string {
  if (choice === 'system') return 'システム配色';
  if (choice === 'light') return 'ライト配色';
  return 'ダーク配色';
}
