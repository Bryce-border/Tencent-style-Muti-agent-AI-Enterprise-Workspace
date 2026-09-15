import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/workflow-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildWorkflow } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const event = (type, payload = {}) => ({ type, payload, created_at: '2026-09-14T10:00:00Z' });
const step = (node_id, depends_on = []) => ({ node_id, depends_on, employee_id: 'document_expert', objective: `完成 ${node_id} 专业工作` });
const task = (overrides = {}) => ({ task_id: 'test', status: 'RUNNING', prompt: '业务目标', plan: [], result: null, employee_id: 'ai_assistant', ...overrides });
const get = (graph, id) => graph.nodes.find(n => n.id === id);

test('parallel workers share a column; unordered dependencies still flow forward', () => {
  const plan = [step('delivery', ['a', 'b']), step('b'), step('a')];
  const graph = buildWorkflow(task({ plan }), [event('plan.created', { plan }), event('agent.node.started', { node_id: 'a' }), event('agent.node.started', { node_id: 'b' })]);
  assert.equal(get(graph, 'worker:a').column, get(graph, 'worker:b').column);
  assert.notEqual(get(graph, 'worker:a').row, get(graph, 'worker:b').row);
  assert.ok(get(graph, 'worker:delivery').column > get(graph, 'worker:a').column);
  assert.equal(graph.nodes.filter(n => n.status === 'running').length, 2);
  assert.deepEqual(get(graph, 'worker:delivery').depends, ['worker:a', 'worker:b']);
});
test('new retry never inherits the prior plan, output or success', () => {
  const plan = [step('a')];
  const events = [event('task.attempt.started'), event('plan.created', { plan }), event('agent.node.completed', { node_id: 'a', output: 'old' }), event('task.attempt.started'), event('planner.started')];
  const graph = buildWorkflow(task({ plan }), events);
  assert.equal(graph.index, 1);
  assert.equal(get(graph, 'worker:a'), undefined);
  assert.equal(get(graph, 'sys:planner').status, 'running');
  assert.equal(graph.nodes.filter(n => n.status === 'running').length, 1);
  assert.equal(get(buildWorkflow(task({ plan }), events, 0), 'worker:a').output, 'old');
});
test('cancelled and recovered runs have no spinning nodes', () => {
  const plan = [step('a')];
  const events = [event('plan.created', { plan }), event('agent.node.started', { node_id: 'a' })];
  for (const graph of [buildWorkflow(task({ status: 'CANCELLED' }), events), buildWorkflow(task({ status: 'PENDING' }), [...events, event('task.recovered')])]) {
    assert.equal(graph.nodes.some(n => n.status === 'running'), false);
    assert.equal(get(graph, 'worker:a').status, 'cancelled');
    assert.notEqual(get(graph, 'sys:archive').status, 'done');
  }
});
test('revision and recheck are distinct and preserve feedback and output', () => {
  const graph = buildWorkflow(task(), [event('review.started', { round: 1 }), event('review.feedback', { feedback: '需要补充来源' }), event('revision.started'), event('revision.completed', { output: '修订结果' }), event('review.started', { round: 2 })]);
  assert.equal(get(graph, 'sys:review').status, 'warning');
  assert.equal(get(graph, 'sys:revision').status, 'done');
  assert.equal(get(graph, 'sys:revision').output, '修订结果');
  assert.equal(get(graph, 'sys:recheck').status, 'running');
  assert.equal(get(graph, 'sys:human'), undefined);
});
test('review timeout enters human handling, never reports automatic success', () => {
  const graph = buildWorkflow(task({ status: 'PENDING_CONFIRMATION', result: { next_action: 'REVIEW_DELIVERABLE', data: { output: '稿件' } } }), [event('review.started'), event('review.unavailable', { stage: 'review', reason: 'TimeoutError' })]);
  assert.equal(get(graph, 'sys:review').status, 'warning');
  assert.equal(get(graph, 'sys:human').status, 'warning');
  assert.equal(get(graph, 'sys:archive').status, 'waiting');
});
test('revision errors attach to the revision node; no imaginary recheck', () => {
  const graph = buildWorkflow(task({ status: 'PENDING_CONFIRMATION' }), [event('review.feedback', { feedback: '修改' }), event('revision.started'), event('review.unavailable', { stage: 'revision', reason: 'ValueError' })]);
  assert.equal(get(graph, 'sys:revision').status, 'failed');
  assert.equal(get(graph, 'sys:revision').events.at(-1).payload.reason, 'ValueError');
  assert.equal(get(graph, 'sys:recheck').status, 'waiting');
});
test('historical missing revision events remain unknown, not fabricated success', () => {
  const graph = buildWorkflow(task({ status: 'SUCCESS' }), [event('review.feedback', { feedback: '修改' }), event('review.completed', { decision: 'PASS' })]);
  assert.equal(get(graph, 'sys:revision').status, 'unknown');
  assert.match(get(graph, 'sys:revision').note, /历史/);
});
test('successful CrewAI output unlocks archive; legacy success does not', () => {
  assert.equal(get(buildWorkflow(task({ status: 'SUCCESS', result: { data: { mode: 'crewai', output: '交付' } } }), []), 'sys:archive').status, 'done');
  assert.notEqual(get(buildWorkflow(task({ status: 'SUCCESS', result: { data: { mode: 'mock', output: '交付' } } }), []), 'sys:archive').status, 'done');
});
test('knowledge skip and provider failure remain separate states', () => {
  assert.equal(get(buildWorkflow(task(), [event('knowledge.skipped')]), 'sys:knowledge').status, 'skipped');
  assert.equal(get(buildWorkflow(task(), [event('knowledge.unavailable')]), 'sys:knowledge').status, 'warning');
});
test('worker failure preserves its error without marking downstream complete', () => {
  const plan = [step('a'), step('b', ['a'])];
  const graph = buildWorkflow(task({ status: 'FAILED' }), [event('plan.created', { plan }), event('agent.node.failed', { node_id: 'a', reason: 'TimeoutError' })]);
  assert.equal(get(graph, 'worker:a').status, 'failed');
  assert.equal(get(graph, 'worker:b').status, 'waiting');
  assert.equal(get(graph, 'sys:archive').status, 'failed');
});
