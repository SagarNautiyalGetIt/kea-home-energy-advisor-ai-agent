type QuestEvent = { mission_id: string; evidence: string; day: string };

/** Match the server's planning boundary, including Auckland daylight saving. */
export function clashDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function plannedQuest(events: readonly QuestEvent[], missionId: string, day: string): boolean {
  return events.some((event) => event.mission_id === missionId && event.evidence === 'planned' && event.day === day);
}

/** A cumulative response proves a plan exists, never that this request earned XP. */
export function planningAcknowledgement(events: readonly QuestEvent[], missionId: string, day: string): string {
  return plannedQuest(events, missionId, day) ? 'In your plan for today' : 'Plan saved · refreshing your progress';
}
