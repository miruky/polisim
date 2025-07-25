// ポリシー評価の本体。全ステートメントを照合し、明示的Deny > Allow > 暗黙のDeny の
// 優先順位で結論を出す。UIが過程を表示できるよう、判断材料をすべてトレースに残す。

import type { Policy, Statement, Effect } from './policy';
import { matchAction, resolveResourcePattern } from './match';
import { evaluateCondition, type ConditionCheck } from './condition';

export interface AccessRequest {
  action: string;
  resource: string;
  /** コンテキストキー名 → 値リスト(単一値キーは要素1つ) */
  context: Record<string, string[]>;
}

export interface ElementTrace {
  matched: boolean;
  /** 一致を決めたパターン(NotAction / NotResource では一致を妨げたパターン) */
  pattern?: string;
  note?: string;
}

export interface StatementTrace {
  index: number;
  sid?: string;
  effect: Effect;
  action: ElementTrace;
  resource: ElementTrace;
  condition: { matched: boolean; checks: ConditionCheck[] };
  /** アクション・リソース・条件のすべてが一致し、このステートメントが適用されたか */
  applied: boolean;
}

export type Decision = 'allow' | 'explicit-deny' | 'implicit-deny';

export interface EvaluationResult {
  decision: Decision;
  /** 結論を決めたステートメントの index(暗黙のDenyでは空) */
  decidedBy: number[];
  traces: StatementTrace[];
}

function traceAction(stmt: Statement, action: string): ElementTrace {
  if (stmt.action !== undefined) {
    const hit = stmt.action.find((p) => matchAction(p, action));
    return hit !== undefined
      ? { matched: true, pattern: hit }
      : { matched: false, note: 'どのActionパターンにも一致しない' };
  }
  const patterns = stmt.notAction ?? [];
  const hit = patterns.find((p) => matchAction(p, action));
  return hit !== undefined
    ? { matched: false, pattern: hit, note: `NotAction の "${hit}" に該当するため対象外` }
    : { matched: true, note: 'NotAction のどれにも該当しないため対象' };
}

function traceResource(stmt: Statement, request: AccessRequest): ElementTrace {
  const patterns = stmt.resource ?? stmt.notResource ?? [];
  const inverted = stmt.resource === undefined;
  const unresolvedNames = new Set<string>();
  let hit: string | undefined;
  for (const p of patterns) {
    const { regex, unresolved } = resolveResourcePattern(p, request.context);
    if (unresolved.length > 0) {
      unresolved.forEach((n) => unresolvedNames.add(n));
      continue; // 未解決の変数を含むパターンは何にも一致しない
    }
    if (regex.test(request.resource)) {
      hit = p;
      break;
    }
  }
  const unresolvedNote =
    unresolvedNames.size > 0
      ? `未解決のポリシー変数: ${[...unresolvedNames].map((n) => '${' + n + '}').join(', ')}(コンテキストに単一値で渡す)`
      : undefined;
  if (inverted) {
    return hit !== undefined
      ? { matched: false, pattern: hit, note: `NotResource の "${hit}" に該当するため対象外` }
      : { matched: true, note: 'NotResource のどれにも該当しないため対象' };
  }
  return hit !== undefined
    ? { matched: true, pattern: hit, note: unresolvedNote }
    : { matched: false, note: unresolvedNote ?? 'どのResourceパターンにも一致しない' };
}

function traceStatement(stmt: Statement, index: number, request: AccessRequest): StatementTrace {
  const action = traceAction(stmt, request.action);
  const resource = traceResource(stmt, request);
  const condition = evaluateCondition(stmt.condition, request.context);
  return {
    index,
    sid: stmt.sid,
    effect: stmt.effect,
    action,
    resource,
    condition,
    applied: action.matched && resource.matched && condition.matched,
  };
}

/**
 * リクエストをポリシーに対して評価する。
 * 適用された Deny が1つでもあれば明示的拒否、なければ適用された Allow で許可、
 * どちらもなければ暗黙の拒否となる。
 */
export function evaluate(policy: Policy, request: AccessRequest): EvaluationResult {
  const traces = policy.statements.map((stmt, i) => traceStatement(stmt, i, request));
  const denies = traces.filter((t) => t.applied && t.effect === 'Deny');
  if (denies.length > 0) {
    return { decision: 'explicit-deny', decidedBy: denies.map((t) => t.index), traces };
  }
  const allows = traces.filter((t) => t.applied && t.effect === 'Allow');
  if (allows.length > 0) {
    return { decision: 'allow', decidedBy: allows.map((t) => t.index), traces };
  }
  return { decision: 'implicit-deny', decidedBy: [], traces };
}
