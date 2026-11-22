// HOW CLOSE A BUILD'S RESULT IS, in words. Presentation only: nothing here
// decides whether a build is accepted, and no margin is defined here.
//
// "Close" is not "within margin". A result inside the accepted margin is what
// a build accepts; it can still be 14% away. So every figure says which of
// the two it is:
//   reward: close within 5% of the amount (CLOSE_REWARD_SHARE, this app's
//           own wording); within margin up to the accepted margin (15%, 25%
//           in Recompletion - offTargetToleranceFor); off target beyond it.
//   spend:  close when the build's own aim is met (demandFit.within: 2%, 4%
//           in Recompletion, at least 10 DR, never looser than the mark);
//           within margin up to the economist's pass mark - 5% of the demand
//           or 30 DR, the smaller (demandMarginFor); off beyond.
//   twists: close inside the 70-75% window; within margin up to 5 points
//           outside it (twisterMark); off beyond, or never reached.
import { offTargetToleranceFor } from '../rewards/smallRewardsWorkflow'
import { twisterMark } from '../rewards/twisterCadence'
import { demandMarginFor } from './eventBuild'

export const CLOSE_REWARD_SHARE = 0.05

// `resource`: { target, predicted } of a built segment. Null without a target.
export function rewardMatch(resource, phase) {
  if (!(resource?.target > 0)) return null
  const off = Math.abs(resource.predicted - resource.target) / resource.target
  return off <= CLOSE_REWARD_SHARE + 1e-9 ? 'close' : off <= offTargetToleranceFor(phase) + 1e-9 ? 'within' : 'off'
}

// `demandFit`: a built segment's (eventBuild.js). Null when nothing is measured.
export function spendMatch(demandFit) {
  if (!demandFit?.paid || !(demandFit.configured > 0) || demandFit.differencePct == null) return null
  const off = Math.abs(demandFit.paid.mean - demandFit.configured)
  const margin = demandMarginFor(demandFit.configured)
  if (demandFit.within && off <= margin + 1e-9) return 'close'
  return off <= margin + 1e-9 ? 'within' : 'off'
}

// `timing`: a Twister row's demandTiming. Null when no twists were asked.
export function twisterMatch(timing) {
  const mark = twisterMark(timing)
  return mark == null ? null : mark === 'in-window' ? 'close' : mark === 'near' ? 'within' : 'off'
}
