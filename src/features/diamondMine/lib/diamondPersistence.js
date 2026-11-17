// Separate from persistence.js on purpose - that module's shape
// ({boards, presets, targetSubsidy}) is a documented single contract for the
// Merge feature; bolting Diamond Mine's unrelated {gems, boards} shape onto
// it would blur that.

const STORAGE_KEY = 'merge-mania-diamond-mine'

export function loadDiamondState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveDiamondState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
