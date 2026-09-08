import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { notificationRoute } from './notification-route.ts';

describe('notificationRoute', () => {
  it('maps supported notification contexts', () => {
    assert.equal(notificationRoute('usage'), '/usage');
    assert.equal(notificationRoute('assistant'), '/assistant');
    assert.equal(notificationRoute('billing'), '/billing');
  });

  it('ignores missing or unsupported destinations', () => {
    assert.equal(notificationRoute(undefined), undefined);
    assert.equal(notificationRoute('profile'), undefined);
  });
});
