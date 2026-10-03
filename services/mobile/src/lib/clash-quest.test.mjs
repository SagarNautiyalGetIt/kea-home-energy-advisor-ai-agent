import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clashDay, plannedQuest, planningAcknowledgement } from './clash-quest.ts';

describe('Power Clash quest progress', () => {
  it('uses the same Auckland day as the server across DST', () => {
    assert.equal(clashDay(new Date('2026-10-03T11:30:00Z')), '2026-10-04');
    assert.equal(clashDay(new Date('2026-07-03T11:30:00Z')), '2026-07-03');
  });
  it('does not confuse verified evidence or yesterday with a daily plan', () => {
    const events = [{ mission_id: 'ev_off_peak', evidence: 'verified', day: '2026-10-03' }, { mission_id: 'ev_off_peak', evidence: 'planned', day: '2026-10-02' }];
    assert.equal(plannedQuest(events, 'ev_off_peak', '2026-10-03'), false);
    assert.equal(plannedQuest([...events, { mission_id: 'ev_off_peak', evidence: 'planned', day: '2026-10-03' }], 'ev_off_peak', '2026-10-03'), true);
    assert.equal(plannedQuest(events, 'review_energy_plan', '2026-10-02'), false);
  });
  it('acknowledges an existing plan without inferring new XP from stale totals', () => {
    const receipt = [{ mission_id: 'ev_off_peak', evidence: 'planned', day: '2026-10-03' }];
    // New and idempotent POSTs contain the same event; neither proves a new award.
    assert.equal(planningAcknowledgement(receipt, 'ev_off_peak', '2026-10-03'), 'In your plan for today');
    assert.equal(planningAcknowledgement([...receipt, { mission_id: 'shift_flexible_load', evidence: 'planned', day: '2026-10-03' }], 'ev_off_peak', '2026-10-03'), 'In your plan for today');
    assert.equal(planningAcknowledgement(receipt, 'ev_off_peak', '2026-10-04'), 'Plan saved · refreshing your progress');
    assert.equal(planningAcknowledgement(receipt, 'review_energy_plan', '2026-10-03'), 'Plan saved · refreshing your progress');
  });
});
