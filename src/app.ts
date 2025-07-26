// 画面の組み立てとイベント配線。評価ロジックは src/lib に分離してあり、
// ここでは状態の読み書きと描画だけを行う。

import { parsePolicy } from './lib/policy';
import { evaluate, type Decision, type EvaluationResult } from './lib/evaluate';
import type { ConditionCheck } from './lib/condition';
import { EXAMPLES } from './lib/examples';

const STORAGE_KEY = 'polisim:v1';

interface SavedState {
  policy: string;
  action: string;
  resource: string;
  context: { key: string; value: string }[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ICONS = {
  ok: '<svg class="icon icon-ok" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.3l1.9 1.9 3.7-4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ng: '<svg class="icon icon-ng" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  none: '<svg class="icon icon-none" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 8h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

const mark = (matched: boolean) => (matched ? ICONS.ok : ICONS.ng);

const BRAND_MARK =
  '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6l22 8v17c0 13-9.5 22.5-22 27C19.5 53.5 10 44 10 31V14z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M21 32.5l7.5 7.5L43 25" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function flowSvg(decision: Decision): string {
  const on = (cond: boolean) => (cond ? ' active' : '');
  const deny = decision === 'explicit-deny';
  const allow = decision === 'allow';
  const implicit = decision === 'implicit-deny';
  const node = (x: number, w: number, label: string, cls: string, active: boolean, y = 30) =>
    `<g class="fnode ${cls}${on(active)}"><rect x="${x}" y="${y}" width="${w}" height="44" rx="10"/>` +
    `<text x="${x + w / 2}" y="${y + 27}" text-anchor="middle">${label}</text></g>`;
  const edge = (d: string, active: boolean, label?: string, lx = 0, ly = 0) =>
    `<path class="fedge${on(active)}" d="${d}" marker-end="url(#fa${active ? '-on' : ''})"/>` +
    (label
      ? `<text class="flabel${on(active)}" x="${lx}" y="${ly}" text-anchor="middle">${label}</text>`
      : '');
  return `<svg class="flow" viewBox="0 0 720 200" role="img" aria-label="評価の決定フロー。明示的Denyが最優先、次にAllow、どちらもなければ暗黙のDenyとなる">
  <title>評価の決定フロー</title>
  <defs>
    <marker id="fa" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" class="fa-head"/></marker>
    <marker id="fa-on" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" class="fa-head-on"/></marker>
  </defs>
  ${node(10, 110, 'リクエスト', 'f-req', true)}
  ${node(170, 150, 'Denyに一致?', 'f-d1', true)}
  ${node(370, 150, 'Allowに一致?', 'f-d2', allow || implicit)}
  ${node(570, 140, '暗黙のDeny', 'outcome-implicit', implicit)}
  ${node(170, 150, '拒否', 'outcome-deny', deny, 130)}
  ${node(370, 150, '許可', 'outcome-allow', allow, 130)}
  ${edge('M120 52 H162', true)}
  ${edge('M320 52 H362', allow || implicit, 'なし', 341, 44)}
  ${edge('M520 52 H562', implicit, 'なし', 541, 44)}
  ${edge('M245 74 V122', deny, 'あり', 262, 102)}
  ${edge('M445 74 V122', allow, 'あり', 462, 102)}
</svg>`;
}

function conditionDetail(check: ConditionCheck): string {
  const expected = check.expected.map((v) => `<code>${esc(v)}</code>`).join(' ');
  const actual =
    check.actual === undefined || check.actual.length === 0
      ? '<em>キーなし</em>'
      : check.actual.map((v) => `<code>${esc(v)}</code>`).join(' ');
  const note = check.note ? `<p class="check-note">${esc(check.note)}</p>` : '';
  return `<li class="cond-check">${mark(check.matched)}<div>
    <p><code class="op">${esc(check.operator)}</code> <code>${esc(check.key)}</code></p>
    <p class="check-vals">期待値: ${expected} / コンテキスト: ${actual}</p>${note}
  </div></li>`;
}

function statementCard(result: EvaluationResult, index: number): string {
  const trace = result.traces[index];
  if (!trace) return '';
  const decided = result.decidedBy.includes(index);
  const sid = trace.sid ? ` <span class="sid">${esc(trace.sid)}</span>` : '';
  const chip = decided
    ? '<span class="chip chip-decided">結論を決めた</span>'
    : trace.applied
      ? '<span class="chip chip-applied">適用</span>'
      : '<span class="chip chip-muted">不適用</span>';
  const element = (label: string, t: { matched: boolean; pattern?: string; note?: string }) => {
    const pattern = t.pattern ? `パターン <code>${esc(t.pattern)}</code>` : '';
    const note = t.note ? esc(t.note) : '';
    const detail = [pattern, note].filter(Boolean).join(' — ') || (t.matched ? '一致' : '不一致');
    return `<li>${mark(t.matched)}<div><span class="check-label">${label}</span><span class="check-detail">${detail}</span></div></li>`;
  };
  const condition =
    trace.condition.checks.length === 0
      ? `<li>${ICONS.none}<div><span class="check-label">条件</span><span class="check-detail">条件なし(常に成立)</span></div></li>`
      : `<li>${mark(trace.condition.matched)}<div><span class="check-label">条件</span>
          <ul class="cond-checks">${trace.condition.checks.map(conditionDetail).join('')}</ul>
        </div></li>`;
  return `<article class="stmt${trace.applied ? ' applied' : ''}${decided ? ' decided' : ''}" style="--i:${index}">
    <header class="stmt-head">
      <span class="stmt-title">Statement ${index + 1}${sid}</span>
      <span class="badge ${trace.effect === 'Allow' ? 'badge-allow' : 'badge-deny'}">${trace.effect}</span>
      ${chip}
    </header>
    <ul class="checks">
      ${element('アクション', trace.action)}
      ${element('リソース', trace.resource)}
      ${condition}
    </ul>
  </article>`;
}

function bannerHtml(result: EvaluationResult, traces: EvaluationResult['traces']): string {
  const names = result.decidedBy
    .map((i) => `Statement ${i + 1}${traces[i]?.sid ? `(${esc(traces[i]?.sid ?? '')})` : ''}`)
    .join('、');
  const info: Record<Decision, { cls: string; title: string; sub: string }> = {
    'explicit-deny': {
      cls: 'banner-deny',
      title: '明示的な拒否(Explicit Deny)',
      sub: `${names} のDenyが適用された。明示的Denyは一致するすべてのAllowに優先する。`,
    },
    allow: {
      cls: 'banner-allow',
      title: '許可(Allow)',
      sub: `${names} のAllowが適用され、一致するDenyはなかった。`,
    },
    'implicit-deny': {
      cls: 'banner-implicit',
      title: '暗黙的な拒否(Implicit Deny)',
      sub: '適用されるステートメントが1つもないため、既定の拒否となる。',
    },
  };
  const { cls, title, sub } = info[result.decision];
  return `<div class="banner ${cls}" role="status">
    ${result.decision === 'allow' ? ICONS.ok : ICONS.ng}
    <div><p class="banner-title">${title}</p><p class="banner-sub">${sub}</p></div>
  </div>`;
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
  <header class="site-header">
    <div class="brand">${BRAND_MARK}<span class="brand-name">polisim</span></div>
    <p class="tagline">IAMポリシーの許可・拒否がどう決まるかを、ステートメント単位で追跡するシミュレータ</p>
  </header>
  <main>
    <section class="pane" aria-labelledby="policy-heading">
      <div class="pane-head">
        <h2 id="policy-heading">ポリシー(JSON)</h2>
        <label class="preset-label">プリセット
          <select id="preset">
            <option value="">自由入力</option>
            ${EXAMPLES.map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <p id="preset-point" class="preset-point" hidden></p>
      <textarea id="policy" spellcheck="false" aria-label="IAMポリシーJSON"></textarea>
      <ul id="policy-errors" class="errors" hidden></ul>
    </section>
    <section class="pane" aria-labelledby="request-heading">
      <h2 id="request-heading">リクエスト</h2>
      <label class="field">アクション
        <input id="action" type="text" placeholder="s3:GetObject" autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">リソースARN
        <input id="resource" type="text" placeholder="arn:aws:s3:::bucket/key" autocomplete="off" spellcheck="false" />
      </label>
      <div class="context-head">
        <h3>コンテキストキー</h3>
        <button type="button" id="add-context" class="ghost">キーを追加</button>
      </div>
      <p class="hint">aws:SourceIp など評価時の状況を表すキー。値はカンマ区切りで複数指定できる。</p>
      <div id="context-rows"></div>
    </section>
    <section class="pane result-pane" aria-labelledby="result-heading">
      <h2 id="result-heading">評価結果</h2>
      <div id="result"></div>
    </section>
  </main>
  <footer class="site-footer">
    <p>評価はすべてブラウザ内で完結し、ポリシーやARNが外部へ送信されることはない。</p>
  </footer>`;

  const policyEl = root.querySelector('#policy') as HTMLTextAreaElement;
  const actionEl = root.querySelector('#action') as HTMLInputElement;
  const resourceEl = root.querySelector('#resource') as HTMLInputElement;
  const presetEl = root.querySelector('#preset') as HTMLSelectElement;
  const presetPointEl = root.querySelector('#preset-point') as HTMLParagraphElement;
  const errorsEl = root.querySelector('#policy-errors') as HTMLUListElement;
  const rowsEl = root.querySelector('#context-rows') as HTMLDivElement;
  const resultEl = root.querySelector('#result') as HTMLDivElement;
  const addContextEl = root.querySelector('#add-context') as HTMLButtonElement;

  function addContextRow(key = '', value = ''): void {
    const row = document.createElement('div');
    row.className = 'context-row';
    row.innerHTML = `
      <input class="ctx-key" placeholder="aws:SourceIp" aria-label="コンテキストキー名" autocomplete="off" spellcheck="false" />
      <input class="ctx-value" placeholder="203.0.113.10" aria-label="値(カンマ区切りで複数)" autocomplete="off" spellcheck="false" />
      <button type="button" class="ctx-remove" aria-label="この行を削除">${ICONS.ng}</button>`;
    (row.querySelector('.ctx-key') as HTMLInputElement).value = key;
    (row.querySelector('.ctx-value') as HTMLInputElement).value = value;
    (row.querySelector('.ctx-remove') as HTMLButtonElement).addEventListener('click', () => {
      row.remove();
      run();
    });
    rowsEl.appendChild(row);
  }

  function readContextRows(): { key: string; value: string }[] {
    return [...rowsEl.querySelectorAll('.context-row')].map((row) => ({
      key: (row.querySelector('.ctx-key') as HTMLInputElement).value.trim(),
      value: (row.querySelector('.ctx-value') as HTMLInputElement).value,
    }));
  }

  function contextMap(): Record<string, string[]> {
    const context: Record<string, string[]> = {};
    for (const { key, value } of readContextRows()) {
      if (key === '') continue;
      const values = value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== '');
      context[key] = values;
    }
    return context;
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function saveState(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const state: SavedState = {
        policy: policyEl.value,
        action: actionEl.value,
        resource: resourceEl.value,
        context: readContextRows(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // プライベートモード等で保存できなくても動作は継続する
      }
    }, 250);
  }

  function loadState(): SavedState | undefined {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return undefined;
      const state = JSON.parse(raw) as SavedState;
      if (typeof state.policy !== 'string' || !Array.isArray(state.context)) return undefined;
      return state;
    } catch {
      return undefined;
    }
  }

  function run(): void {
    const { policy, errors } = parsePolicy(policyEl.value);
    if (errors.length > 0 || !policy) {
      errorsEl.hidden = false;
      errorsEl.innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
      resultEl.innerHTML =
        '<p class="placeholder">ポリシーのエラーを解消すると評価結果が表示される。</p>';
      saveState();
      return;
    }
    errorsEl.hidden = true;
    errorsEl.innerHTML = '';
    const result = evaluate(policy, {
      action: actionEl.value.trim(),
      resource: resourceEl.value.trim(),
      context: contextMap(),
    });
    resultEl.innerHTML =
      bannerHtml(result, result.traces) +
      flowSvg(result.decision) +
      `<div class="stmts">${result.traces.map((_, i) => statementCard(result, i)).join('')}</div>`;
    saveState();
  }

  function applyExample(id: string): void {
    const example = EXAMPLES.find((e) => e.id === id);
    if (!example) return;
    policyEl.value = example.policy;
    actionEl.value = example.request.action;
    resourceEl.value = example.request.resource;
    rowsEl.innerHTML = '';
    for (const { key, value } of example.request.context) addContextRow(key, value);
    presetPointEl.hidden = false;
    presetPointEl.textContent = example.point;
    run();
  }

  presetEl.addEventListener('change', () => {
    if (presetEl.value !== '') applyExample(presetEl.value);
  });
  addContextEl.addEventListener('click', () => {
    addContextRow();
    (rowsEl.lastElementChild?.querySelector('.ctx-key') as HTMLInputElement | null)?.focus();
  });
  for (const el of [policyEl, actionEl, resourceEl]) {
    el.addEventListener('input', () => {
      presetEl.value = '';
      presetPointEl.hidden = true;
      run();
    });
  }
  rowsEl.addEventListener('input', run);

  const saved = loadState();
  if (saved) {
    policyEl.value = saved.policy;
    actionEl.value = saved.action;
    resourceEl.value = saved.resource;
    for (const { key, value } of saved.context) addContextRow(key, value);
    run();
  } else {
    const first = EXAMPLES[0];
    if (first) {
      presetEl.value = first.id;
      applyExample(first.id);
    }
  }
}
