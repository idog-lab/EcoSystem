import { Component, lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react'
import { modelBySlug } from '../registry/catalog'
import { MODEL_MODULES, type ModelPageProps } from '../registry/modules'
import { goHome } from '../routing/router'
import { MessagePage } from './MessagePage'

// /models/<slug>: the registry says which module; the module is loaded only
// now. Moving a model between folders never changes this URL.

const PAGES = Object.fromEntries(Object.entries(MODEL_MODULES).map(([key, load]) => [key, lazy(load)])) as Record<
  string,
  ComponentType<ModelPageProps>
>

export default function ModelRoute({ slug }: { slug: string }) {
  const model = modelBySlug(slug)
  useEffect(() => {
    document.title = model ? `${model.displayName} · Economy design toolkit` : 'Unknown model · Economy design toolkit'
  }, [model])

  if (!model) {
    return <MessagePage title="Unknown model" text={`There is no model at “${slug}”. It may have been renamed or never existed.`} />
  }
  const Page = PAGES[model.moduleKey]!
  return (
    <LoadBoundary name={model.displayName}>
      <Suspense fallback={<MessagePage title={`Opening ${model.displayName}…`} text="" quiet />}>
        <Page model={model} onHome={goHome} />
      </Suspense>
    </LoadBoundary>
  )
}

class LoadBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) return <MessagePage title={`${this.props.name} could not be opened`} text="Reload the page to try again." />
    return this.props.children
  }
}
