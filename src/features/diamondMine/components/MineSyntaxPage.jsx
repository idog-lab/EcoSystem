import { useState } from 'react'
import { FileCode2, Copy, Check } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import { diamondBoardsToSyntax } from '../lib/diamondSyntax'

export default function MineSyntaxPage({ boards, gemsById }) {
  const [copied, setCopied] = useState(false)
  const syntax = diamondBoardsToSyntax(boards, gemsById)

  async function handleCopy() {
    await navigator.clipboard.writeText(syntax)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card
      title="Syntax export"
      subtitle="Draft export for the Ops handoff — placeholder format, not final; swap it out in src/lib/diamondSyntax.js once the real spec exists"
      icon={FileCode2}
      action={
        <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      }
    >
      <pre className="text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto whitespace-pre">{syntax}</pre>
    </Card>
  )
}
