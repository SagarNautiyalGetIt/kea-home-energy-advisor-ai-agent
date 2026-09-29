/** The local model has no household fact pack. Keep its remit deliberately narrow. */
export function canAnswerWithLocalModel(question: string): boolean {
  const text = question.trim().toLowerCase();
  if (!text || text.length > 320) return false;
  if (/\b(my|mine|our|ours|me|us|account|address|bill|payment|plan|price|tariff|usage|meter|home|household|suburb|rank|credit|carbon offset|last|today|yesterday|tomorrow|this month|this week)\b/.test(text)) return false;
  return /\b(solar|off[ -]?peak|peak hours|heat pump|insulation|standby|electric vehicle|ev charging|energy efficiency|saving energy|electricity grid)\b/.test(text)
    && /\b(what|how|why|explain|tips|ways|difference|can|does|is)\b/.test(text);
}

export const LOCAL_EVIDENCE_LIMIT =
  'On-phone Sparky can explain general energy topics, but it has no verified copy of your household data yet. Connect to Kea to check your bill, usage, plan, devices, or Power Clash progress.';
