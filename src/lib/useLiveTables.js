import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { invalidate, liveRefresher } from './lazyData'

let channelCount = 0

// Real-time updates for a page: when any row of `tables` changes (a POS sale, an edit by the
// secretary, a stock or price change, ...), the cached answers starting with `cachePrefix` (one
// prefix or a list) are dropped and `reload` runs. Price changes also drop the shared price cache.
// A burst of changes reloads once (after `delay` ms of quiet), and nothing reloads while the tab is hidden (it catches up when the tab is shown again).
// Who receives a change is still decided by Row Level Security.
export default function useLiveTables(tables, reload, { cachePrefix = '', delay = 800 } = {}) {
  // always call the newest reload (it usually depends on the page's filters)
  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  })

  const key = tables.join(',')
  const prefixList = [cachePrefix].flat().filter(Boolean)
  if (/(^|,)(lpg_prices|branch_prices)(,|$)/.test(key)) prefixList.push('prices:')
  const prefixKey = prefixList.join('|')
  useEffect(() => {
    const prefixes = prefixKey ? prefixKey.split('|') : []
    const live = liveRefresher(() => {
      for (const prefix of prefixes) invalidate(prefix)
      reloadRef.current()
    }, delay)
    const channel = supabase.channel(`live:${key}:${++channelCount}`)
    for (const table of key.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, live.trigger)
    }
    channel.subscribe()
    return () => {
      live.stop()
      supabase.removeChannel(channel)
    }
  }, [key, prefixKey, delay])
}
