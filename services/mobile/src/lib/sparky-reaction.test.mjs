import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import ts from 'typescript';

const source = readFileSync(new URL('./sparky-reaction.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { sparkyReactionForTap, sparkyFace } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

// Exercise the real unchanged reference engine, with TypeScript-only imports erased.
const modules = new Map();
async function engineModule(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const pending = (async () => {
    let code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const match of [...code.matchAll(/from '(\.\/[\w-]+)'/g)]) {
      const dependency = await engineModule(new URL(match[1] + '.ts', url));
      code = code.replace(match[0], `from '${dependency}'`);
    }
    return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  })();
  modules.set(url.href, pending);
  return pending;
}
const { BotEngine } = await import(await engineModule(new URL('../vendor/bloub/engine.ts', import.meta.url)));
const { EXPRESSION_BY_ID } = await import(await engineModule(new URL('../vendor/bloub/expressions.ts', import.meta.url)));

test('mascot taps cycle original facial states with bounded automatic-return deadlines', () => {
  const reactions = [0, 1, 2].map(sparkyReactionForTap);
  assert.deepEqual(reactions.map(({ state }) => state), ['wink', 'wide', 'idle']);
  assert.equal(sparkyReactionForTap(3), reactions[0]);
  assert.equal(sparkyReactionForTap(Number.NaN), reactions[0]);
  for (const reaction of reactions) assert.ok(reaction.durationMs >= 1600 && reaction.durationMs <= 2200);
  assert.deepEqual(sparkyFace('idle'), { state: 'idle', expression: 'neutre', mouth: 'idle', reactionLabel: undefined });
});

test('tap expressions preserve work status and independent response mouth', () => {
  for (const mode of ['thinking', 'replying']) {
    for (let tap = 0; tap < 3; tap++) {
      const reaction = sparkyReactionForTap(tap);
      const face = sparkyFace(mode, reaction);
      assert.equal(face.mouth, mode);
      assert.equal(face.expression, reaction.expression);
    }
  }
  assert.equal(sparkyFace('idle', sparkyReactionForTap(0)).mouth, 'happy');
  assert.equal(sparkyFace('replying').expression, 'attentif');
});

test('reduced motion uses a still expressive face without state animation', () => {
  for (let tap = 0; tap < 3; tap++) {
    const reaction = sparkyReactionForTap(tap);
    const face = sparkyFace('idle', reaction, true);
    assert.equal(face.state, 'idle');
    assert.equal(face.expression, reaction.expression);
    assert.equal(face.reactionLabel, reaction.stillLabel);
  }
});

test('real reference eyes show a wink then recover without a disappearing body', () => {
  const engine = new BotEngine(100, 'idle');
  engine.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 0 }, 0);
  const reaction = sparkyReactionForTap(0);
  const wink = sparkyFace('idle', reaction);
  engine.setState(wink.state, 0);
  engine.setExpression(EXPRESSION_BY_ID.get(wink.expression), 0);
  const frame = engine.sample(0.8);
  assert.equal(frame.bodyAlpha, 1);
  assert.equal(frame.eyes.length, 2);
  assert.notEqual(frame.eyes[0].d, frame.eyes[1].d);
  assert.ok(frame.eyes.every(({ alpha }) => alpha > 0));
  const restored = sparkyFace('idle');
  engine.setState(restored.state, reaction.durationMs / 1000);
  engine.setExpression(EXPRESSION_BY_ID.get(restored.expression), reaction.durationMs / 1000);
  const after = engine.sample(reaction.durationMs / 1000 + 0.7);
  assert.equal(engine.state, 'idle');
  assert.equal(after.bodyAlpha, 1);
  assert.equal(after.eyes[0].d, after.eyes[1].d);
});
