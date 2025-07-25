import { describe, it, expect } from 'vitest';
import { evaluateCondition, ipInCidr, ipToInt } from './condition';

const single = (
  operator: string,
  key: string,
  expected: string[],
  context: Record<string, string[]>,
) => evaluateCondition({ [operator]: { [key]: expected } }, context);

describe('ipToInt / ipInCidr', () => {
  it('IPv4アドレスを整数化する', () => {
    expect(ipToInt('0.0.0.0')).toBe(0);
    expect(ipToInt('255.255.255.255')).toBe(0xffffffff);
    expect(ipToInt('10.0.0.256')).toBeUndefined();
    expect(ipToInt('not-an-ip')).toBeUndefined();
  });

  it('CIDR範囲の包含を判定する', () => {
    expect(ipInCidr('203.0.113.7', '203.0.113.0/24')).toBe(true);
    expect(ipInCidr('203.0.114.7', '203.0.113.0/24')).toBe(false);
    expect(ipInCidr('198.51.100.10', '198.51.100.10/32')).toBe(true);
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
  });

  it('プレフィックス長省略時は /32 とみなす', () => {
    expect(ipInCidr('198.51.100.10', '198.51.100.10')).toBe(true);
    expect(ipInCidr('198.51.100.11', '198.51.100.10')).toBe(false);
  });

  it('不正なCIDRは一致しない', () => {
    expect(ipInCidr('10.0.0.1', '10.0.0.0/33')).toBe(false);
    expect(ipInCidr('10.0.0.1', 'garbage')).toBe(false);
  });
});

describe('文字列演算子', () => {
  it('StringEquals は完全一致(大文字小文字を区別)', () => {
    expect(single('StringEquals', 'k', ['dev'], { k: ['dev'] }).matched).toBe(true);
    expect(single('StringEquals', 'k', ['dev'], { k: ['Dev'] }).matched).toBe(false);
  });

  it('期待値リストはORで評価される', () => {
    expect(single('StringEquals', 'k', ['dev', 'stg'], { k: ['stg'] }).matched).toBe(true);
  });

  it('StringEqualsIgnoreCase は大文字小文字を無視する', () => {
    expect(single('StringEqualsIgnoreCase', 'k', ['dev'], { k: ['DEV'] }).matched).toBe(true);
  });

  it('StringLike はワイルドカードを使える', () => {
    expect(
      single('StringLike', 'k', ['arn:*:role/admin-?'], { k: ['arn:aws:role/admin-1'] }).matched,
    ).toBe(true);
  });

  it('StringNotEquals はすべての期待値と異なるとき一致する', () => {
    expect(single('StringNotEquals', 'k', ['dev', 'stg'], { k: ['prod'] }).matched).toBe(true);
    expect(single('StringNotEquals', 'k', ['dev', 'stg'], { k: ['stg'] }).matched).toBe(false);
  });
});

describe('数値・日付・Bool演算子', () => {
  it('NumericLessThan などの比較', () => {
    expect(single('NumericLessThan', 'k', ['100'], { k: ['99'] }).matched).toBe(true);
    expect(single('NumericGreaterThanEquals', 'k', ['100'], { k: ['100'] }).matched).toBe(true);
    expect(single('NumericEquals', 'k', ['10'], { k: ['010'] }).matched).toBe(true);
  });

  it('数値でない値は一致しない', () => {
    expect(single('NumericEquals', 'k', ['10'], { k: ['ten'] }).matched).toBe(false);
  });

  it('日付はISO 8601とepoch秒を比較できる', () => {
    expect(
      single('DateLessThan', 'aws:CurrentTime', ['2026-12-31T23:59:59Z'], {
        'aws:CurrentTime': ['2026-06-01T00:00:00Z'],
      }).matched,
    ).toBe(true);
    expect(single('DateEquals', 'k', ['2026-01-01T00:00:00Z'], { k: ['1767225600'] }).matched).toBe(
      true,
    );
  });

  it('Bool は文字列表現の真偽値を比較する', () => {
    expect(single('Bool', 'k', ['true'], { k: ['True'] }).matched).toBe(true);
    expect(single('Bool', 'k', ['true'], { k: ['false'] }).matched).toBe(false);
  });
});

describe('IP・ARN演算子', () => {
  it('IpAddress はCIDR包含で一致する', () => {
    expect(
      single('IpAddress', 'aws:SourceIp', ['203.0.113.0/24'], { 'aws:SourceIp': ['203.0.113.9'] })
        .matched,
    ).toBe(true);
  });

  it('NotIpAddress は範囲外のとき一致する', () => {
    expect(
      single('NotIpAddress', 'aws:SourceIp', ['203.0.113.0/24'], { 'aws:SourceIp': ['192.0.2.1'] })
        .matched,
    ).toBe(true);
  });

  it('ArnLike はワイルドカード付きARNで一致する', () => {
    expect(
      single('ArnLike', 'aws:SourceArn', ['arn:aws:sns:*:123456789012:*'], {
        'aws:SourceArn': ['arn:aws:sns:ap-northeast-1:123456789012:alerts'],
      }).matched,
    ).toBe(true);
  });
});

describe('キー不在時の挙動', () => {
  it('肯定形の演算子は不一致になる', () => {
    const check = single('StringEquals', 'k', ['v'], {}).checks[0];
    expect(check?.matched).toBe(false);
    expect(check?.note).toContain('存在しない');
  });

  it('否定形の演算子は一致になる', () => {
    const check = single('StringNotEquals', 'k', ['v'], {}).checks[0];
    expect(check?.matched).toBe(true);
    expect(check?.note).toContain('否定形');
  });

  it('IfExists を付けると一致扱いになる', () => {
    expect(single('StringEqualsIfExists', 'k', ['v'], {}).matched).toBe(true);
    expect(single('BoolIfExists', 'aws:MultiFactorAuthPresent', ['false'], {}).matched).toBe(true);
  });

  it('Null 演算子はキーの存在自体を判定する', () => {
    expect(single('Null', 'k', ['true'], {}).matched).toBe(true);
    expect(single('Null', 'k', ['true'], { k: ['v'] }).matched).toBe(false);
    expect(single('Null', 'k', ['false'], { k: ['v'] }).matched).toBe(true);
  });
});

describe('複数値キー', () => {
  it('ForAllValues はすべての値が期待値に含まれるとき一致する', () => {
    expect(
      single('ForAllValues:StringEquals', 'aws:TagKeys', ['env', 'team'], {
        'aws:TagKeys': ['env', 'team'],
      }).matched,
    ).toBe(true);
    expect(
      single('ForAllValues:StringEquals', 'aws:TagKeys', ['env', 'team'], {
        'aws:TagKeys': ['env', 'cost'],
      }).matched,
    ).toBe(false);
  });

  it('ForAllValues は空集合(キー不在)で一致する', () => {
    const check = single('ForAllValues:StringEquals', 'aws:TagKeys', ['env'], {}).checks[0];
    expect(check?.matched).toBe(true);
    expect(check?.note).toContain('空集合');
  });

  it('ForAnyValue はいずれかの値が一致すれば一致する', () => {
    expect(
      single('ForAnyValue:StringEquals', 'aws:TagKeys', ['env'], {
        'aws:TagKeys': ['cost', 'env'],
      }).matched,
    ).toBe(true);
    expect(single('ForAnyValue:StringEquals', 'aws:TagKeys', ['env'], {}).matched).toBe(false);
  });

  it('複数値キーを単一値演算子で評価すると不一致になり注記が付く', () => {
    const check = single('StringEquals', 'k', ['a'], { k: ['a', 'b'] }).checks[0];
    expect(check?.matched).toBe(false);
    expect(check?.note).toContain('ForAllValues');
  });
});

describe('ブロック全体の結合', () => {
  it('演算子・キーをまたいだ条件はANDになる', () => {
    const result = evaluateCondition(
      {
        StringEquals: { 'aws:PrincipalTag/team': ['payments'] },
        Bool: { 'aws:SecureTransport': ['true'] },
      },
      { 'aws:PrincipalTag/team': ['payments'], 'aws:SecureTransport': ['false'] },
    );
    expect(result.matched).toBe(false);
    expect(result.checks).toHaveLength(2);
  });

  it('Conditionがなければ一致する', () => {
    expect(evaluateCondition(undefined, {}).matched).toBe(true);
  });

  it('未対応の演算子は不一致として扱い注記を残す', () => {
    const check = single('BinaryEquals', 'k', ['dGVzdA=='], { k: ['dGVzdA=='] }).checks[0];
    expect(check?.matched).toBe(false);
    expect(check?.note).toContain('未対応');
  });
});
