// プリセット。IAMの評価でつまずきやすい典型パターンを、ポリシーとリクエストの組で示す。

export interface Example {
  id: string;
  label: string;
  /** このプリセットが示す評価の要点 */
  point: string;
  policy: string;
  request: {
    action: string;
    resource: string;
    context: { key: string; value: string }[];
  };
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export const EXAMPLES: Example[] = [
  {
    id: 'deny-precedence',
    label: '明示的Denyの優先',
    point: 'Allowに一致していても、1つでもDenyに一致すれば結論は拒否になる',
    policy: json({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowS3Read',
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:ListBucket'],
          Resource: 'arn:aws:s3:::*',
        },
        {
          Sid: 'DenyKessanBuckets',
          Effect: 'Deny',
          Action: 's3:*',
          Resource: ['arn:aws:s3:::kessan-*', 'arn:aws:s3:::kessan-*/*'],
        },
      ],
    }),
    request: {
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::kessan-2026/q1-report.pdf',
      context: [],
    },
  },
  {
    id: 'mfa-required',
    label: 'MFAのない破壊的操作を拒否',
    point: 'BoolIfExists はキー不在時に一致扱いとなり、MFA情報がない経路も塞げる',
    policy: json({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowEc2Ops',
          Effect: 'Allow',
          Action: 'ec2:*',
          Resource: '*',
        },
        {
          Sid: 'DenyDestructiveWithoutMfa',
          Effect: 'Deny',
          Action: ['ec2:StopInstances', 'ec2:TerminateInstances'],
          Resource: '*',
          Condition: {
            BoolIfExists: { 'aws:MultiFactorAuthPresent': 'false' },
          },
        },
      ],
    }),
    request: {
      action: 'ec2:TerminateInstances',
      resource: 'arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc1234',
      context: [{ key: 'aws:MultiFactorAuthPresent', value: 'false' }],
    },
  },
  {
    id: 'ip-restriction',
    label: '社内IP以外を拒否',
    point: 'NotIpAddress は範囲外のとき一致する。送信元が範囲内ならDenyは適用されない',
    policy: json({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowOrdersTable',
          Effect: 'Allow',
          Action: 'dynamodb:*',
          Resource: 'arn:aws:dynamodb:ap-northeast-1:123456789012:table/orders',
        },
        {
          Sid: 'DenyOutsideOffice',
          Effect: 'Deny',
          Action: '*',
          Resource: '*',
          Condition: {
            NotIpAddress: { 'aws:SourceIp': ['203.0.113.0/24', '198.51.100.10/32'] },
          },
        },
      ],
    }),
    request: {
      action: 'dynamodb:Query',
      resource: 'arn:aws:dynamodb:ap-northeast-1:123456789012:table/orders',
      context: [{ key: 'aws:SourceIp', value: '192.0.2.50' }],
    },
  },
  {
    id: 'policy-variable',
    label: 'ポリシー変数でホームディレクトリ',
    point: '${aws:username} はコンテキスト値で展開され、ユーザーごとの範囲を1文で書ける',
    policy: json({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowOwnHomeDir',
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject'],
          Resource: 'arn:aws:s3:::team-bucket/home/${aws:username}/*',
        },
      ],
    }),
    request: {
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::team-bucket/home/sato/notes.md',
      context: [{ key: 'aws:username', value: 'sato' }],
    },
  },
  {
    id: 'tag-keys',
    label: 'タグキーをForAllValuesで制限',
    point: '複数値キーには ForAllValues / ForAnyValue を使う。空集合が一致する点にも注意',
    policy: json({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowTaggingWithKnownKeys',
          Effect: 'Allow',
          Action: 'ec2:CreateTags',
          Resource: '*',
          Condition: {
            'ForAllValues:StringEquals': { 'aws:TagKeys': ['env', 'team', 'owner'] },
          },
        },
      ],
    }),
    request: {
      action: 'ec2:CreateTags',
      resource: 'arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc1234',
      context: [{ key: 'aws:TagKeys', value: 'env, team, cost-center' }],
    },
  },
];
