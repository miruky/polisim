import { describe, it, expect } from 'vitest';
import { parsePolicy } from './policy';

describe('parsePolicy', () => {
  it('文字列のAction/Resourceを配列へ正規化する', () => {
    const { policy, errors } = parsePolicy(
      JSON.stringify({
        Version: '2012-10-17',
        Statement: { Effect: 'Allow', Action: 's3:GetObject', Resource: '*' },
      }),
    );
    expect(errors).toEqual([]);
    expect(policy?.statements).toEqual([
      { effect: 'Allow', action: ['s3:GetObject'], resource: ['*'] },
    ]);
  });

  it('Sid・NotAction・NotResource・Conditionを読み取る', () => {
    const { policy } = parsePolicy(
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'S1',
            Effect: 'Deny',
            NotAction: ['iam:*'],
            NotResource: 'arn:aws:iam::*:role/admin',
            Condition: { Bool: { 'aws:SecureTransport': false } },
          },
        ],
      }),
    );
    const stmt = policy?.statements[0];
    expect(stmt?.sid).toBe('S1');
    expect(stmt?.notAction).toEqual(['iam:*']);
    expect(stmt?.notResource).toEqual(['arn:aws:iam::*:role/admin']);
    expect(stmt?.condition).toEqual({ Bool: { 'aws:SecureTransport': ['false'] } });
  });

  it('条件値の数値・真偽値・配列を文字列リストへ正規化する', () => {
    const { policy } = parsePolicy(
      JSON.stringify({
        Statement: {
          Effect: 'Allow',
          Action: '*',
          Resource: '*',
          Condition: { NumericLessThan: { 'aws:MultiSessionCount': 3 } },
        },
      }),
    );
    expect(policy?.statements[0]?.condition).toEqual({
      NumericLessThan: { 'aws:MultiSessionCount': ['3'] },
    });
  });

  it('壊れたJSONを報告する', () => {
    const { policy, errors } = parsePolicy('{ "Statement": ');
    expect(policy).toBeUndefined();
    expect(errors[0]).toContain('JSONとして解析できない');
  });

  it('Effectの欠落や不正値を報告する', () => {
    const { errors } = parsePolicy(
      JSON.stringify({ Statement: { Effect: 'allow', Action: '*', Resource: '*' } }),
    );
    expect(errors[0]).toContain('Effect');
  });

  it('ActionとNotActionの同時指定を報告する', () => {
    const { errors } = parsePolicy(
      JSON.stringify({
        Statement: { Effect: 'Allow', Action: '*', NotAction: '*', Resource: '*' },
      }),
    );
    expect(errors[0]).toContain('同時に指定できない');
  });

  it('Resource系の欠落を報告する', () => {
    const { errors } = parsePolicy(JSON.stringify({ Statement: { Effect: 'Allow', Action: '*' } }));
    expect(errors[0]).toContain('Resource または NotResource');
  });

  it('Principalを含むポリシーを対象外として報告する', () => {
    const { errors } = parsePolicy(
      JSON.stringify({
        Statement: { Effect: 'Allow', Principal: '*', Action: '*', Resource: '*' },
      }),
    );
    expect(errors[0]).toContain('アイデンティティベース');
  });

  it('フィールド名の綴り間違いを報告する', () => {
    const { errors } = parsePolicy(
      JSON.stringify({ Statement: { Effect: 'Allow', Actions: '*', Resource: '*' } }),
    );
    expect(errors[0]).toContain('"Actions"');
  });

  it('不正なVersionを報告する', () => {
    const { errors } = parsePolicy(
      JSON.stringify({
        Version: '2012-10-18',
        Statement: { Effect: 'Allow', Action: '*', Resource: '*' },
      }),
    );
    expect(errors[0]).toContain('Version');
  });

  it('複数ステートメントのエラーを位置つきで集める', () => {
    const { errors } = parsePolicy(
      JSON.stringify({
        Statement: [
          { Effect: 'Allow', Action: '*', Resource: '*' },
          { Effect: 'Deny', Resource: '*' },
        ],
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Statement[1]');
  });
});
