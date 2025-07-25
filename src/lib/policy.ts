// IAMポリシーJSONの解析と検証。アイデンティティベースポリシーを対象とする。

export type Effect = 'Allow' | 'Deny';

export interface Statement {
  sid?: string;
  effect: Effect;
  action?: string[];
  notAction?: string[];
  resource?: string[];
  notResource?: string[];
  /** 演算子 → コンテキストキー → 期待値リスト */
  condition?: Record<string, Record<string, string[]>>;
}

export interface Policy {
  version?: string;
  statements: Statement[];
}

export interface ParseResult {
  policy?: Policy;
  errors: string[];
}

const STATEMENT_FIELDS = new Set([
  'Sid',
  'Effect',
  'Action',
  'NotAction',
  'Resource',
  'NotResource',
  'Condition',
]);

function toStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value as string[];
  }
  return undefined;
}

/** 条件の期待値はJSONの数値・真偽値でも書けるため、文字列に正規化する。 */
function toConditionValues(value: unknown): string[] | undefined {
  const single = (v: unknown): string | undefined =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : undefined;
  if (Array.isArray(value)) {
    const values = value.map(single);
    return values.every((v) => v !== undefined) ? (values as string[]) : undefined;
  }
  const v = single(value);
  return v === undefined ? undefined : [v];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatement(raw: unknown, label: string, errors: string[]): Statement | undefined {
  if (!isPlainObject(raw)) {
    errors.push(`${label}: ステートメントはオブジェクトで書く`);
    return undefined;
  }

  for (const field of Object.keys(raw)) {
    if (field === 'Principal' || field === 'NotPrincipal') {
      errors.push(
        `${label}: ${field} はリソースベースポリシーの要素。本ツールはアイデンティティベースポリシーを評価対象とする`,
      );
      return undefined;
    }
    if (!STATEMENT_FIELDS.has(field)) {
      errors.push(`${label}: 不明なフィールド "${field}"(綴りを確認)`);
      return undefined;
    }
  }

  const effect = raw.Effect;
  if (effect !== 'Allow' && effect !== 'Deny') {
    errors.push(`${label}: Effect は "Allow" か "Deny" のいずれかが必須`);
    return undefined;
  }

  if ('Action' in raw && 'NotAction' in raw) {
    errors.push(`${label}: Action と NotAction は同時に指定できない`);
    return undefined;
  }
  if (!('Action' in raw) && !('NotAction' in raw)) {
    errors.push(`${label}: Action または NotAction が必須`);
    return undefined;
  }
  if ('Resource' in raw && 'NotResource' in raw) {
    errors.push(`${label}: Resource と NotResource は同時に指定できない`);
    return undefined;
  }
  if (!('Resource' in raw) && !('NotResource' in raw)) {
    errors.push(`${label}: Resource または NotResource が必須`);
    return undefined;
  }

  const stmt: Statement = { effect };

  if ('Sid' in raw) {
    if (typeof raw.Sid !== 'string') {
      errors.push(`${label}: Sid は文字列で書く`);
      return undefined;
    }
    stmt.sid = raw.Sid;
  }

  for (const [field, key] of [
    ['Action', 'action'],
    ['NotAction', 'notAction'],
    ['Resource', 'resource'],
    ['NotResource', 'notResource'],
  ] as const) {
    if (field in raw) {
      const values = toStringArray(raw[field]);
      if (values === undefined) {
        errors.push(`${label}: ${field} は文字列または文字列の配列で書く`);
        return undefined;
      }
      stmt[key] = values;
    }
  }

  if ('Condition' in raw) {
    const cond = raw.Condition;
    if (!isPlainObject(cond)) {
      errors.push(`${label}: Condition はオブジェクトで書く`);
      return undefined;
    }
    const condition: Record<string, Record<string, string[]>> = {};
    for (const [operator, block] of Object.entries(cond)) {
      if (!isPlainObject(block)) {
        errors.push(`${label}: Condition の "${operator}" はキーと値のオブジェクトで書く`);
        return undefined;
      }
      const keys: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(block)) {
        const values = toConditionValues(value);
        if (values === undefined) {
          errors.push(`${label}: 条件キー "${key}" の値は文字列・数値・真偽値かその配列で書く`);
          return undefined;
        }
        keys[key] = values;
      }
      condition[operator] = keys;
    }
    stmt.condition = condition;
  }

  return stmt;
}

/** ポリシーJSON文字列を解析する。エラーがあれば policy は返さない。 */
export function parsePolicy(source: string): ParseResult {
  const errors: string[] = [];
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch (e) {
    return { errors: [`JSONとして解析できない: ${e instanceof Error ? e.message : String(e)}`] };
  }

  if (!isPlainObject(root)) {
    return { errors: ['ポリシーのルートはオブジェクトで書く'] };
  }

  let version: string | undefined;
  if ('Version' in root) {
    if (root.Version !== '2012-10-17' && root.Version !== '2008-10-17') {
      errors.push('Version は "2012-10-17" を指定する(古い "2008-10-17" も受け付ける)');
    } else {
      version = root.Version;
    }
  }

  for (const field of Object.keys(root)) {
    if (field !== 'Version' && field !== 'Statement' && field !== 'Id') {
      errors.push(`不明なトップレベルフィールド "${field}"`);
    }
  }

  if (!('Statement' in root)) {
    errors.push('Statement が必須');
    return { errors };
  }

  const rawStatements = Array.isArray(root.Statement) ? root.Statement : [root.Statement];
  if (rawStatements.length === 0) {
    errors.push('Statement が空。少なくとも1つのステートメントを書く');
    return { errors };
  }

  const statements: Statement[] = [];
  rawStatements.forEach((raw, i) => {
    const stmt = parseStatement(raw, `Statement[${i}]`, errors);
    if (stmt) statements.push(stmt);
  });

  if (errors.length > 0) return { errors };
  return { policy: { version, statements }, errors };
}
