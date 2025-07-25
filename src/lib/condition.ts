// Conditionブロックの評価。演算子ごとの照合と、キー不在・複数値の取り扱いを担う。

import { wildcardToRegExp, lookupContext } from './match';

export interface ConditionCheck {
  /** ポリシーに書かれたままの演算子(ForAllValues: や IfExists を含む) */
  operator: string;
  key: string;
  expected: string[];
  actual: string[] | undefined;
  matched: boolean;
  /** 一致・不一致の理由のうち、値の比較だけでは読み取れないもの */
  note?: string;
}

export interface ConditionResult {
  matched: boolean;
  checks: ConditionCheck[];
}

/** IPv4アドレスを32bit整数へ。不正な形式は undefined。 */
export function ipToInt(ip: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return (
    (((parts[0] as number) << 24) |
      ((parts[1] as number) << 16) |
      ((parts[2] as number) << 8) |
      (parts[3] as number)) >>>
    0
  );
}

/** IPv4アドレスがCIDR範囲に含まれるか。プレフィックス長省略時は /32 とみなす。 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base ?? '');
  if (ipInt === undefined || baseInt === undefined) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** 日付値を epoch ミリ秒へ。ISO 8601 と epoch 秒(数字のみ)を受け付ける。 */
function dateToMillis(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

type ValueTest = (actual: string, expected: string[]) => boolean;

function numeric(cmp: (a: number, b: number) => boolean): ValueTest {
  return (actual, expected) => {
    const a = Number(actual);
    if (actual.trim() === '' || Number.isNaN(a)) return false;
    return expected.some((v) => {
      const b = Number(v);
      return v.trim() !== '' && !Number.isNaN(b) && cmp(a, b);
    });
  };
}

function dated(cmp: (a: number, b: number) => boolean): ValueTest {
  return (actual, expected) => {
    const a = dateToMillis(actual);
    if (a === undefined) return false;
    return expected.some((v) => {
      const b = dateToMillis(v);
      return b !== undefined && cmp(a, b);
    });
  };
}

const like: ValueTest = (actual, expected) =>
  expected.some((v) => wildcardToRegExp(v).test(actual));

// 肯定形の演算子。期待値リストのいずれかに一致すれば true(OR)。
const TESTS: Record<string, ValueTest> = {
  StringEquals: (a, e) => e.includes(a),
  StringEqualsIgnoreCase: (a, e) => e.some((v) => v.toLowerCase() === a.toLowerCase()),
  StringLike: like,
  NumericEquals: numeric((a, b) => a === b),
  NumericLessThan: numeric((a, b) => a < b),
  NumericLessThanEquals: numeric((a, b) => a <= b),
  NumericGreaterThan: numeric((a, b) => a > b),
  NumericGreaterThanEquals: numeric((a, b) => a >= b),
  DateEquals: dated((a, b) => a === b),
  DateLessThan: dated((a, b) => a < b),
  DateLessThanEquals: dated((a, b) => a <= b),
  DateGreaterThan: dated((a, b) => a > b),
  DateGreaterThanEquals: dated((a, b) => a >= b),
  Bool: (a, e) => e.some((v) => v.toLowerCase() === a.toLowerCase()),
  IpAddress: (a, e) => e.some((v) => ipInCidr(a, v)),
  // AWSの仕様上、ArnEquals と ArnLike は同じ挙動(どちらもワイルドカード可)
  ArnEquals: like,
  ArnLike: like,
};

// 否定形の演算子と、対応する肯定形の対応表
const NEGATIONS: Record<string, string> = {
  StringNotEquals: 'StringEquals',
  StringNotEqualsIgnoreCase: 'StringEqualsIgnoreCase',
  StringNotLike: 'StringLike',
  NumericNotEquals: 'NumericEquals',
  DateNotEquals: 'DateEquals',
  ArnNotEquals: 'ArnEquals',
  ArnNotLike: 'ArnLike',
  NotIpAddress: 'IpAddress',
};

function checkOne(
  rawOperator: string,
  key: string,
  expected: string[],
  context: Record<string, string[]>,
): ConditionCheck {
  let op = rawOperator;
  let quantifier: 'single' | 'all' | 'any' = 'single';
  if (op.startsWith('ForAllValues:')) {
    quantifier = 'all';
    op = op.slice('ForAllValues:'.length);
  } else if (op.startsWith('ForAnyValue:')) {
    quantifier = 'any';
    op = op.slice('ForAnyValue:'.length);
  }
  let ifExists = false;
  if (op.endsWith('IfExists') && op !== 'IfExists') {
    ifExists = true;
    op = op.slice(0, -'IfExists'.length);
  }

  const actual = lookupContext(context, key);
  const base = { operator: rawOperator, key, expected, actual };

  if (op === 'Null') {
    // 期待値 "true" はキーの不在を、"false" は存在を要求する
    const present = actual !== undefined && actual.length > 0;
    const wanted = expected.some((v) => v.toLowerCase() === (present ? 'false' : 'true'));
    return {
      ...base,
      matched: wanted,
      note: present ? 'キーは存在する' : 'キーは存在しない',
    };
  }

  const negated = op in NEGATIONS;
  const test = TESTS[negated ? (NEGATIONS[op] as string) : op];
  if (test === undefined) {
    return { ...base, matched: false, note: `未対応の条件演算子(不一致として扱う)` };
  }

  if (actual === undefined || actual.length === 0) {
    if (ifExists) {
      return { ...base, matched: true, note: 'キーが存在しないため、IfExists により一致扱い' };
    }
    if (quantifier === 'all') {
      return {
        ...base,
        matched: true,
        note: 'ForAllValues は空集合に対して一致する(意図しない許可の典型例)',
      };
    }
    if (negated) {
      return {
        ...base,
        matched: true,
        note: '否定形の演算子はキーが存在しない場合に一致する(見落としやすい挙動)',
      };
    }
    return { ...base, matched: false, note: 'キーがリクエストコンテキストに存在しない' };
  }

  const testValue = (v: string) => (negated ? !test(v, expected) : test(v, expected));

  if (quantifier === 'all') {
    return { ...base, matched: actual.every(testValue) };
  }
  if (quantifier === 'any') {
    return { ...base, matched: actual.some(testValue) };
  }
  if (actual.length > 1) {
    return {
      ...base,
      matched: false,
      note: '複数値キーを単一値の演算子で評価した(ForAllValues / ForAnyValue を付ける)',
    };
  }
  return { ...base, matched: testValue(actual[0] as string) };
}

/** Conditionブロック全体を評価する。演算子・キーをまたいだ条件はANDで結合される。 */
export function evaluateCondition(
  condition: Record<string, Record<string, string[]>> | undefined,
  context: Record<string, string[]>,
): ConditionResult {
  if (condition === undefined) return { matched: true, checks: [] };
  const checks: ConditionCheck[] = [];
  for (const [operator, block] of Object.entries(condition)) {
    for (const [key, expected] of Object.entries(block)) {
      checks.push(checkOne(operator, key, expected, context));
    }
  }
  return { matched: checks.every((c) => c.matched), checks };
}
