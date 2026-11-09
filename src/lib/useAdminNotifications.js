import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

const LIMIT = 60 // the newest notifications kept in the panel

// The admin's notifications (table admin_notifications, written by database triggers: sales,
// voids, edits by staff, low stock, accounts waiting, ...). Updates live.
// Returns { items, unread, seenAt, markAllRead, fresh, dismissFresh }:
//   unread = notifications newer than the last time the admin opened the panel
//   fresh  = notifications that arrived while the page was open (for the pop-ups)
export default function useAdminNotifications(userId) {
  const [items, setItems] = useState([])
  const [seenAt, setSeenAt] = useState(null) // ISO time; null = never opened
  const [fresh, setFresh] = useState([])
  const loaded = useRef(false)

  useEffect(() => {
    if (!userId) return
    let alive = true
    const load = async () => {
      const [list, read] = await Promise.all([
        supabase.from('admin_notifications').select('*').order('created_at', { ascending: false }).limit(LIMIT),
        supabase.from('admin_notification_reads').select('seen_at').eq('user_id', userId).maybeSingle(),
      ])
      if (!alive) return
      if (!list.error) setItems(list.data)
      if (!read.error) setSeenAt(read.data?.seen_at ?? null)
      loaded.current = true
    }
    load()

    // a new notification, or one that grew (another line of the same sale, a later edit)
    const upsert = (row, isNew) => {
      setItems((list) => [row, ...list.filter((x) => x.id !== row.id)].slice(0, LIMIT))
      if (isNew && loaded.current) setFresh((list) => [...list.filter((x) => x.id !== row.id), row].slice(-4))
      else setFresh((list) => list.map((x) => (x.id === row.id ? row : x))) // a pop-up shows the whole sale
    }
    const channel = supabase
      .channel(`admin-notifications-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_notifications' }, (p) => upsert(p.new, true))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'admin_notifications' }, (p) => upsert(p.new, false))
      // catch up after the connection was lost (laptop asleep, network down)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && loaded.current) load()
      })
    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
  }, [userId])

  const unread = items.filter((n) => !seenAt || n.created_at > seenAt).length

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    setSeenAt(now)
    await supabase.from('admin_notification_reads').upsert({ user_id: userId, seen_at: now })
  }, [userId])

  const dismissFresh = useCallback((id) => setFresh((list) => list.filter((x) => x.id !== id)), [])

  return { items, unread, seenAt, markAllRead, fresh, dismissFresh }
}
