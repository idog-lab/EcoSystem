import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { hrefOf, navigate } from './router'

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string; state?: Record<string, unknown> }

/** An ordinary link (open in a new tab works) that navigates in place on a plain click. */
export function Link({ to, state, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return
    e.preventDefault()
    navigate(to, { state })
    window.scrollTo(0, 0)
  }
  return <a href={hrefOf(to)} onClick={handle} {...rest} />
}
