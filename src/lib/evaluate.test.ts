import { describe, it, expect } from 'vitest';
import { evaluate, type AccessRequest } from './evaluate';
import { parsePolicy, type Policy } from './policy';
import { EXAMPLES } from './examples';

function policyOf(doc: unknown): Policy {
  const { policy, errors } = parsePolicy(JSON.stringify(doc));
  expect(errors).toEqual([]);
  if (!policy) throw new Error('parse failed');
  return policy;
}

const req = (
  action: string,
  resource: string,
  context: Record<string, string[]> = {},
): AccessRequest => ({ action, resource, context });

describe('evaluate', () => {
  const readOnly = policyOf({
    Version: '2012-10-17',
    Statement: [
      { Sid: 'Read', Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: '*' },
      { Sid: 'Guard', Effect: 'Deny', Action: 's3:*', Resource: 'arn:aws:s3:::secret/*' },
    ],
  });

  it('一致するAllowがあれば許可する', () => {
    const result = evaluate(readOnly, req('s3:GetObject', 'arn:aws:s3:::pub/a.txt'));
    expect(result.decision).toBe('allow');
    expect(result.decidedBy).toEqual([0]);
  });

  it('Denyが一致すればAllowより優先される', () => {
    const result = evaluate(readOnly, req('s3:GetObject', 'arn:aws:s3:::secret/key.pem'));
    expect(result.decision).toBe('explicit-deny');
    expect(result.decidedBy).toEqual([1]);
    expect(result.traces[0]?.applied).toBe(true);
  });

  it('どのステートメントにも一致しなければ暗黙の拒否になる', () => {
    const result = evaluate(readOnly, req('s3:PutObject', 'arn:aws:s3:::pub/a.txt'));
    expect(result.decision).toBe('implicit-deny');
    expect(result.decidedBy).toEqual([]);
    expect(result.traces[0]?.action.matched).toBe(false);
  });

  it('条件が成立しないステートメントは適用されない', () => {
    const policy = policyOf({
      Statement: [
        {
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: '*',
          Condition: { Bool: { 'aws:SecureTransport': 'true' } },
        },
      ],
    });
    const denied = evaluate(
      policy,
      req('s3:GetObject', 'arn:aws:s3:::b/k', { 'aws:SecureTransport': ['false'] }),
    );
    expect(denied.decision).toBe('implicit-deny');
    expect(denied.traces[0]?.condition.matched).toBe(false);

    const allowed = evaluate(
      policy,
      req('s3:GetObject', 'arn:aws:s3:::b/k', { 'aws:SecureTransport': ['true'] }),
    );
    expect(allowed.decision).toBe('allow');
  });

  it('NotActionは列挙したアクション以外を対象にする', () => {
    const policy = policyOf({
      Statement: [{ Effect: 'Deny', NotAction: ['s3:Get*', 's3:List*'], Resource: '*' }],
    });
    expect(evaluate(policy, req('s3:DeleteObject', 'arn:aws:s3:::b/k')).decision).toBe(
      'explicit-deny',
    );
    const excluded = evaluate(policy, req('s3:GetObject', 'arn:aws:s3:::b/k'));
    expect(excluded.decision).toBe('implicit-deny');
    expect(excluded.traces[0]?.action.note).toContain('NotAction');
  });

  it('NotResourceは列挙したリソース以外を対象にする', () => {
    const policy = policyOf({
      Statement: [{ Effect: 'Allow', Action: 's3:*', NotResource: 'arn:aws:s3:::secret/*' }],
    });
    expect(evaluate(policy, req('s3:GetObject', 'arn:aws:s3:::open/a')).decision).toBe('allow');
    expect(evaluate(policy, req('s3:GetObject', 'arn:aws:s3:::secret/a')).decision).toBe(
      'implicit-deny',
    );
  });

  it('リソースのポリシー変数をコンテキストで解決する', () => {
    const policy = policyOf({
      Statement: [
        {
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::home/${aws:username}/*',
        },
      ],
    });
    expect(
      evaluate(
        policy,
        req('s3:GetObject', 'arn:aws:s3:::home/sato/a.txt', { 'aws:username': ['sato'] }),
      ).decision,
    ).toBe('allow');

    const unresolved = evaluate(policy, req('s3:GetObject', 'arn:aws:s3:::home/sato/a.txt'));
    expect(unresolved.decision).toBe('implicit-deny');
    expect(unresolved.traces[0]?.resource.note).toContain('未解決のポリシー変数');
  });

  it('結論を決めたステートメントをすべて報告する', () => {
    const policy = policyOf({
      Statement: [
        { Effect: 'Allow', Action: 's3:GetObject', Resource: '*' },
        { Effect: 'Allow', Action: 's3:*', Resource: '*' },
      ],
    });
    expect(evaluate(policy, req('s3:GetObject', 'arn:aws:s3:::b/k')).decidedBy).toEqual([0, 1]);
  });

  it('トレースには一致したパターンが残る', () => {
    const result = evaluate(readOnly, req('s3:ListBucket', 'arn:aws:s3:::pub'));
    expect(result.traces[0]?.action.pattern).toBe('s3:ListBucket');
    expect(result.traces[0]?.resource.pattern).toBe('*');
  });
});

describe('プリセット', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s のポリシーは解析できる', (_id, example) => {
    const { errors } = parsePolicy(example.policy);
    expect(errors).toEqual([]);
  });

  it('明示的Denyの優先プリセットは拒否で終わる', () => {
    const example = EXAMPLES.find((e) => e.id === 'deny-precedence');
    if (!example) throw new Error('preset missing');
    const { policy } = parsePolicy(example.policy);
    if (!policy) throw new Error('parse failed');
    const context: Record<string, string[]> = {};
    for (const { key, value } of example.request.context) context[key] = [value];
    const result = evaluate(policy, {
      action: example.request.action,
      resource: example.request.resource,
      context,
    });
    expect(result.decision).toBe('explicit-deny');
  });
});
