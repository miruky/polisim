import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, type ShareState } from './share';

const sample: ShareState = {
  policy:
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:*","Resource":"*"}]}',
  action: 's3:GetObject',
  resource: 'arn:aws:s3:::例のバケット/鍵',
  context: [{ key: 'aws:SourceIp', value: '203.0.113.10' }],
};

describe('encodeState / decodeState', () => {
  it('日本語を含む状態を往復しても等しい', () => {
    expect(decodeState(encodeState(sample))).toEqual(sample);
  });

  it('URLフラグメントに安全な文字だけを使う', () => {
    expect(encodeState(sample)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('空のコンテキスト行は落とす', () => {
    const encoded = encodeState({ ...sample, context: [{ key: '', value: '' }] });
    expect(decodeState(encoded)?.context).toEqual([]);
  });

  it('壊れた入力ではnullを返す', () => {
    expect(decodeState('')).toBeNull();
    expect(decodeState('@@not-valid@@')).toBeNull();
    expect(decodeState(btoa('{"no":"policy"}'))).toBeNull();
  });
});
