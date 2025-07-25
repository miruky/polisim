// IAMポリシーのパターン照合。ワイルドカード(* と ?)とポリシー変数 ${key} を扱う。

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(s: string): string {
  return s.replace(REGEXP_SPECIALS, '\\$&');
}

/** ワイルドカードパターンを正規表現へ変換する。* は任意長、? は1文字に対応する。 */
export function wildcardToRegExp(pattern: string, flags = ''): RegExp {
  let src = '';
  for (const ch of pattern) {
    if (ch === '*') src += '.*';
    else if (ch === '?') src += '.';
    else src += escapeRegExp(ch);
  }
  return new RegExp(`^${src}$`, flags);
}

/** アクション名の照合。IAMの仕様に合わせて大文字小文字を区別しない。 */
export function matchAction(pattern: string, action: string): boolean {
  return wildcardToRegExp(pattern, 'i').test(action);
}

/** コンテキストキーは大文字小文字を区別せずに引く。 */
export function lookupContext(
  context: Record<string, string[]>,
  key: string,
): string[] | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(context)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

export interface ResolvedPattern {
  regex: RegExp;
  /** コンテキストから解決できなかったポリシー変数名 */
  unresolved: string[];
}

/**
 * リソースパターンを正規表現へ解決する。大文字小文字を区別する。
 * ポリシー変数 ${key} はコンテキストの単一値で展開し、展開後の文字列は
 * リテラルとして扱う(値に * が含まれてもワイルドカードにならない)。
 * ${*} ${?} ${$} はそれぞれのリテラル文字を表すIAMのエスケープ記法。
 */
export function resolveResourcePattern(
  pattern: string,
  context: Record<string, string[]>,
): ResolvedPattern {
  let src = '';
  const unresolved: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === '$' && pattern[i + 1] === '{') {
      const end = pattern.indexOf('}', i + 2);
      if (end === -1) {
        src += escapeRegExp(pattern.slice(i));
        break;
      }
      const name = pattern.slice(i + 2, end);
      if (name === '*' || name === '?' || name === '$') {
        src += escapeRegExp(name);
      } else {
        const values = lookupContext(context, name);
        if (values !== undefined && values.length === 1) {
          src += escapeRegExp(values[0] as string);
        } else {
          // 未解決の変数を含むパターンは何にも一致しない(IAMと同じ挙動)
          unresolved.push(name);
          src += escapeRegExp(pattern.slice(i, end + 1));
        }
      }
      i = end + 1;
    } else {
      if (ch === '*') src += '.*';
      else if (ch === '?') src += '.';
      else src += escapeRegExp(ch);
      i += 1;
    }
  }
  return { regex: new RegExp(`^${src}$`), unresolved };
}

/** リソースARNの照合。一致したら true。未解決変数があるパターンは一致しない。 */
export function matchResource(
  pattern: string,
  resource: string,
  context: Record<string, string[]> = {},
): boolean {
  const { regex, unresolved } = resolveResourcePattern(pattern, context);
  return unresolved.length === 0 && regex.test(resource);
}
