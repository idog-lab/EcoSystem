import { useMemo } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react'
import Card from '../../../components/ui/Card'
import { validateChefConfig, SEVERITY_ORDER, SEVERITY_LABELS } from '../lib/chefValidation'

const SEVERITY_STYLE = {
  block: { icon: XCircle, className: 'text-red-700 bg-red-50 border-red-200' },
  review: { icon: AlertTriangle, className: 'text-amber-700 bg-amber-50 border-amber-200' },
  info: { icon: Info, className: 'text-slate-600 bg-slate-50 border-slate-200' },
}

export default function ValidationTab({ ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants }) {
  const findings = useMemo(
    () => validateChefConfig({ ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants }),
    [ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants]
  )

  const bySeverity = SEVERITY_ORDER.map((severity) => ({ severity, items: findings.filter((f) => f.severity === severity) }))
  const blockCount = findings.filter((f) => f.severity === 'block').length

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Validation"
        subtitle="Checks run live against the current config — this tab never stores anything of its own, it just reads Ingredients/Dishes/Baskets/Calendar/Segments/Grants."
      >
        {findings.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
            <CheckCircle2 size={16} className="shrink-0" /> No issues found.
          </div>
        )}
        {findings.length > 0 && (
          <div className={`flex items-center gap-2 text-sm rounded-xl px-3 py-2.5 border ${blockCount > 0 ? 'text-red-800 bg-red-50 border-red-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
            {blockCount > 0 ? <XCircle size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />}
            {blockCount > 0 ? `${blockCount} issue${blockCount === 1 ? '' : 's'} would block release.` : 'No blocking issues — some items are worth a look.'}
          </div>
        )}
      </Card>

      {bySeverity.map(
        ({ severity, items }) =>
          items.length > 0 && (
            <Card key={severity} title={`${SEVERITY_LABELS[severity]} (${items.length})`}>
              <div className="flex flex-col gap-2">
                {items.map((f, i) => {
                  const { icon: Icon, className } = SEVERITY_STYLE[severity]
                  return (
                    <div key={i} className={`flex items-start gap-2 text-sm rounded-xl px-3 py-2 border ${className}`}>
                      <Icon size={14} className="shrink-0 mt-0.5" />
                      <span>
                        <span className="font-semibold">{f.area}:</span> {f.message}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
      )}
    </div>
  )
}
