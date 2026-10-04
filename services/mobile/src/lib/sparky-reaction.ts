import type { MouthMode } from './sparky-mouth';
import type { ExpressionId } from '../vendor/bloub/expressions';
import type { StateId } from '../vendor/bloub/states';

export type SparkyReaction = {
  state: StateId;
  expression: ExpressionId;
  mouth: MouthMode;
  durationMs: number;
  label: string;
  stillLabel: string;
};

/** Use the reference's face repertoire; these states keep its original round body. */
const REACTIONS: readonly SparkyReaction[] = [
  { state: 'wink', expression: 'heureux', mouth: 'happy', durationMs: 1800, label: 'winking', stillLabel: 'smiling' },
  { state: 'wide', expression: 'surpris', mouth: 'thinking', durationMs: 2000, label: 'looking curious', stillLabel: 'looking curious' },
  { state: 'idle', expression: 'heureux', mouth: 'happy', durationMs: 2200, label: 'smiling', stillLabel: 'smiling' },
];

export function sparkyReactionForTap(tap: number): SparkyReaction {
  const index = Number.isFinite(tap) ? Math.max(0, Math.floor(tap)) % REACTIONS.length : 0;
  return REACTIONS[index]!;
}

/** A playful eye reaction never overwrites the assistant's thinking/responding mouth. */
export function sparkyFace(mode: MouthMode, reaction?: SparkyReaction, reduceMotion = false) {
  return {
    state: reaction && !reduceMotion ? reaction.state : 'idle' as StateId,
    expression: reaction?.expression ?? (mode === 'happy' ? 'heureux' : mode === 'replying' ? 'attentif' : 'neutre') as ExpressionId,
    mouth: mode === 'thinking' || mode === 'replying' ? mode : reaction?.mouth ?? mode,
    reactionLabel: reaction ? reduceMotion ? reaction.stillLabel : reaction.label : undefined,
  };
}
