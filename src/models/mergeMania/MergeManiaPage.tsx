import { EditorApp } from '../../App.jsx'
import type { ModelPageProps } from '../../platform/registry/modules'

// Merge Mania's page is its existing editor, unchanged.
export default function MergeManiaPage({ onHome }: ModelPageProps) {
  return <EditorApp onHome={onHome} />
}
