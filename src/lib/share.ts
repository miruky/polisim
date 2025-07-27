// ポリシーとリクエストをURLフラグメントへ可逆に詰める。共有リンクから同じ評価を再現できる。
// 日本語を含むためUTF-8で符号化し、URLに安全なbase64urlを用いる。

export interface ShareState {
  policy: string;
  action: string;
  resource: string;
  context: { key: string; value: string }[];
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeState(state: ShareState): string {
  const context = state.context.filter((c) => c.key !== '' || c.value !== '');
  const minimal = {
    p: state.policy,
    a: state.action,
    r: state.resource,
    c: context.map((c) => [c.key, c.value]),
  };
  return base64UrlEncode(JSON.stringify(minimal));
}

function toContext(value: unknown): { key: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { key: string; value: string }[] = [];
  for (const item of value) {
    if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') {
      out.push({ key: item[0], value: item[1] });
    }
  }
  return out;
}

// 壊れた・改竄された入力ではnullを返し、呼び出し側で既定へフォールバックできるようにする
export function decodeState(encoded: string): ShareState | null {
  if (encoded === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(encoded));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['p'] !== 'string') return null;
  return {
    policy: obj['p'],
    action: typeof obj['a'] === 'string' ? obj['a'] : '',
    resource: typeof obj['r'] === 'string' ? obj['r'] : '',
    context: toContext(obj['c']),
  };
}
