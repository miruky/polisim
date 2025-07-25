import { describe, it, expect } from 'vitest';
import { matchAction, matchResource, resolveResourcePattern, lookupContext } from './match';

describe('matchAction', () => {
  it('完全一致する', () => {
    expect(matchAction('s3:GetObject', 's3:GetObject')).toBe(true);
    expect(matchAction('s3:GetObject', 's3:PutObject')).toBe(false);
  });

  it('大文字小文字を区別しない', () => {
    expect(matchAction('s3:getobject', 'S3:GetObject')).toBe(true);
  });

  it('* は任意の文字列に一致する', () => {
    expect(matchAction('s3:Get*', 's3:GetObject')).toBe(true);
    expect(matchAction('s3:*', 's3:DeleteBucket')).toBe(true);
    expect(matchAction('*', 'iam:PassRole')).toBe(true);
    expect(matchAction('s3:Get*', 's3:PutObject')).toBe(false);
  });

  it('? は1文字に一致する', () => {
    expect(matchAction('s3:Get?bject', 's3:GetObject')).toBe(true);
    expect(matchAction('s3:Get?', 's3:GetObject')).toBe(false);
  });

  it('正規表現の特殊文字をリテラルとして扱う', () => {
    expect(matchAction('s3:Get.bject', 's3:GetObject')).toBe(false);
  });
});

describe('matchResource', () => {
  it('大文字小文字を区別する', () => {
    expect(matchResource('arn:aws:s3:::Bucket', 'arn:aws:s3:::bucket')).toBe(false);
    expect(matchResource('arn:aws:s3:::bucket', 'arn:aws:s3:::bucket')).toBe(true);
  });

  it('ワイルドカードはARNの区切りを越えて一致する', () => {
    expect(matchResource('arn:aws:s3:::logs-*', 'arn:aws:s3:::logs-2026/app.log')).toBe(true);
  });
});

describe('resolveResourcePattern', () => {
  it('ポリシー変数をコンテキストの単一値で展開する', () => {
    const { regex, unresolved } = resolveResourcePattern('arn:aws:s3:::home/${aws:username}/*', {
      'aws:username': ['sato'],
    });
    expect(unresolved).toEqual([]);
    expect(regex.test('arn:aws:s3:::home/sato/file.txt')).toBe(true);
    expect(regex.test('arn:aws:s3:::home/suzuki/file.txt')).toBe(false);
  });

  it('変数名の大文字小文字は区別しない', () => {
    const { regex } = resolveResourcePattern('prefix/${AWS:UserName}', {
      'aws:username': ['sato'],
    });
    expect(regex.test('prefix/sato')).toBe(true);
  });

  it('展開された値のワイルドカード文字はリテラルとして扱う', () => {
    const { regex } = resolveResourcePattern('bucket/${aws:username}/data', {
      'aws:username': ['*'],
    });
    expect(regex.test('bucket/*/data')).toBe(true);
    expect(regex.test('bucket/anything/data')).toBe(false);
  });

  it('コンテキストにない変数は未解決として報告する', () => {
    const { unresolved } = resolveResourcePattern('bucket/${aws:username}', {});
    expect(unresolved).toEqual(['aws:username']);
  });

  it('複数値のコンテキストキーでは解決しない', () => {
    const { unresolved } = resolveResourcePattern('bucket/${aws:TagKeys}', {
      'aws:TagKeys': ['a', 'b'],
    });
    expect(unresolved).toEqual(['aws:TagKeys']);
  });

  it('${*} ${?} ${$} はリテラル文字のエスケープ', () => {
    const { regex, unresolved } = resolveResourcePattern('a${*}b${?}c${$}d', {});
    expect(unresolved).toEqual([]);
    expect(regex.test('a*b?c$d')).toBe(true);
    expect(regex.test('aXbYc$d')).toBe(false);
  });

  it('未解決変数があっても他のパターンの照合には影響しない', () => {
    expect(matchResource('bucket/${aws:username}', 'bucket/sato', {})).toBe(false);
  });
});

describe('lookupContext', () => {
  it('キーの大文字小文字を無視して引く', () => {
    expect(lookupContext({ 'aws:SourceIp': ['10.0.0.1'] }, 'aws:sourceip')).toEqual(['10.0.0.1']);
    expect(lookupContext({ 'aws:SourceIp': ['10.0.0.1'] }, 'aws:other')).toBeUndefined();
  });
});
