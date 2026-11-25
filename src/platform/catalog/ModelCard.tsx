import type { DragEvent } from 'react'
import { Link } from '../routing/Link'
import { modelPath } from '../routing/routes'
import type { ModelEntry } from '../registry/types'
import type { Folder } from '../organization/useOrganization'
import ModelIcon from './ModelIcon'
import MoveToFolderMenu from './MoveToFolderMenu'
import { MODEL_DRAG_TYPE } from './dragModel'

// A card is a link holding ONLY the model's icon and name. Dragging it (when
// folders are available) moves the model; a drag never opens it, because the
// browser sends no click after a drag. "Move to folder" sits beside the link.

type Props = {
  model: ModelEntry
  folders: Folder[] | null
  folderId: string | null
  onMove: (folderId: string | null) => void
}

export default function ModelCard({ model, folders, folderId, onMove }: Props) {
  const canMove = folders !== null
  const onDragStart = (e: DragEvent<HTMLAnchorElement>) => {
    e.dataTransfer.setData(MODEL_DRAG_TYPE, model.id)
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <li className="relative" data-model-id={model.id}>
      <Link
        to={modelPath(model.slug)}
        state={{ fromHome: true }}
        draggable={canMove}
        onDragStart={canMove ? onDragStart : undefined}
        className={`flex min-h-24 items-center gap-4 rounded-2xl border border-purple-100/80 bg-white p-5 shadow-sm shadow-purple-950/5 transition hover:-translate-y-0.5 hover:border-purple-200 hover:shadow-md hover:shadow-purple-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 ${canMove ? 'pr-14' : ''}`}
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-purple-100/80 text-purple-700">
          <ModelIcon iconKey={model.iconKey} size={24} />
        </span>
        <span className="font-display text-xl font-bold tracking-tight text-slate-900">{model.displayName}</span>
      </Link>
      {canMove && <MoveToFolderMenu modelName={model.displayName} currentFolderId={folderId} folders={folders} onMove={onMove} />}
    </li>
  )
}
