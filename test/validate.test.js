import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTask } from '../src/validate.js';
import { baseTask } from './fixtures.js';

test('official sample shape validates', () => {
  const v = validateTask(baseTask());
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.task.minimum, 1000n);
  assert.equal(v.task.public_balance, 1460n);
});

test('wrong type string → invalid', () => {
  const t = baseTask({ type: 'agent-games.something-else.v1' });
  assert.equal(validateTask(t).ok, false);
});

test('missing input field → invalid', () => {
  const t = baseTask();
  delete t.input.proof_tx;
  const v = validateTask(t);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('proof_tx')));
});

test('non-hex vk → invalid', () => {
  const v = validateTask(baseTask({}, { registered_vk: 'not-a-hash' }));
  assert.equal(v.ok, false);
});

test('float amount → invalid (no silent rounding)', () => {
  const v = validateTask(baseTask({}, { amount: 500.5 }));
  assert.equal(v.ok, false);
});

test('negative amount string → invalid', () => {
  const v = validateTask(baseTask({}, { amount: '-5' }));
  assert.equal(v.ok, false);
});

test('leading-zero decimal → invalid (strict canonical form)', () => {
  const v = validateTask(baseTask({}, { minimum: '01000' }));
  assert.equal(v.ok, false);
});

test('missing task_id → invalid', () => {
  const t = baseTask();
  delete t.task_id;
  assert.equal(validateTask(t).ok, false);
});

test('non-object body → invalid', () => {
  assert.equal(validateTask(null).ok, false);
  assert.equal(validateTask([1, 2]).ok, false);
  assert.equal(validateTask('x').ok, false);
});
