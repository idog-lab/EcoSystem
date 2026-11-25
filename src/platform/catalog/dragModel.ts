// The data a dragged model card carries. A custom type, so dropping a card
// anywhere else (the search box, another tab) does nothing.
export const MODEL_DRAG_TYPE = 'application/x-economy-model'

export const isModelDrag = (e: { dataTransfer: DataTransfer | null }) => !!e.dataTransfer?.types.includes(MODEL_DRAG_TYPE)
