import { useEffect, useRef } from 'react'

/** Auto-demo helper: run `fn` once `ms` after `when` becomes true (cancelled if it turns false). */
export function useAfter(when: boolean, ms: number, fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  useEffect(() => {
    if (!when) return
    const id = setTimeout(() => ref.current(), ms)
    return () => clearTimeout(id)
  }, [when, ms])
}
