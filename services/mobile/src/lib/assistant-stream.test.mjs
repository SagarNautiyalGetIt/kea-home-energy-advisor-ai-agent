import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseChartEvent, parseSseFrames } from './assistant-stream.ts';

describe('assistant SSE frames', () => {
  it('handles a CRLF frame split across XHR progress events', () => {
    const partial = 'event: token\r\ndata: {"text":"Hello"}\r\n';
    const first = parseSseFrames(partial, 0);
    assert.deepEqual(first.frames, []);
    assert.equal(first.offset, 0);

    const response = partial + '\r\nevent: chart\r\ndata: {"kind":"bar","title":"Bill","unit":"nzd","points":[{"label":"This bill","value":42,"highlight":true}],"caveat":null,"source":"bill row"}\r\n\r\nevent: done\r\ndata: {"tier":1}\r\n\r\n';
    const second = parseSseFrames(response, first.offset);
    assert.deepEqual(second.frames.map((frame) => frame.event), ['token', 'chart', 'done']);
    assert.deepEqual(second.frames[0].payload, { text: 'Hello' });
    assert.deepEqual(second.frames[2].payload, { tier: 1 });
    assert.equal(second.offset, response.length);
  });

  it('skips malformed JSON without losing a later done frame', () => {
    const response = 'event: token\ndata: {bad}\n\nevent: done\ndata: {"tier":3}\n\n';
    assert.deepEqual(parseSseFrames(response, 0).frames, [
      { event: 'done', payload: { tier: 3 } },
    ]);
  });
});

describe('assistant chart payload', () => {
  const measured = {
    kind: 'line',
    title: 'Daily use',
    unit: 'kwh',
    points: [
      { label: 'Mon', value: 4.2, highlight: false },
      { label: 'Tue', value: 5.1, highlight: true },
    ],
    caveat: 'Meter totals',
    source: 'household meter',
  };

  it('preserves the exact points and provenance supplied by the API', () => {
    assert.deepEqual(parseChartEvent(measured), measured);
  });

  it('rejects missing and malformed values instead of rendering a zero', () => {
    assert.equal(parseChartEvent({ ...measured, points: [] }), null);
    assert.equal(parseChartEvent({ ...measured, points: [{ label: 'Mon', value: null, highlight: false }] }), null);
    assert.equal(parseChartEvent({ ...measured, points: [{ label: 'Mon', value: Infinity, highlight: false }] }), null);
  });
});
