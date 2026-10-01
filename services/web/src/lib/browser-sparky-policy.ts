/** A browser model has no account facts. Only broad energy education may use it. */
export function canAnswerInBrowser(question: string): boolean {
  const text = question.trim().toLowerCase()
  if (!text || text.length > 320) return false
  if (/\b(i|we|my|mine|our|ours|me|us|account|address|bill|payment|plan|price|cost|rate|tariff|usage|meter|home|household|suburb|rank|credit|carbon offset|forecast|last|today|yesterday|tomorrow|this month|this week)\b/.test(text)) return false
  return /\b(solar|off[ -]?peak|peak hours|heat pump|insulation|standby|electric vehicle|ev charging|energy efficiency|saving energy|electricity grid)\b/.test(text)
    && /\b(what|how|why|explain|tips|ways|difference|can|does|is)\b/.test(text)
}
