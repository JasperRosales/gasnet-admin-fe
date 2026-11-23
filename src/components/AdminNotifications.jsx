import { useEffect, useRef, useState } from 'react'
import { peso } from '../lib/money'
import { branchName } from '../lib/branches'
import { alertDialog, confirmDialog } from '../lib/dialogs'

// how each kind of notification looks, and which filter it belongs to
const KINDS = {
  sale: { label: 'Sale', dot: 'bg-brand-pine', group: 'sales' },
  website: { label: 'Website order', dot: 'bg-sky-600', group: 'sales' },
  void: { label: 'Voided', dot: 'bg-brand-red', group: 'changes' },
  edit: { label: 'Edited', dot: 'bg-amber-500', group: 'changes' },
  delete: { label: 'Deleted', dot: 'bg-brand-red', group: 'changes' },
  log: { label: 'Sales log', dot: 'bg-amber-500', group: 'changes' },
  low_stock: { label: 'Low stock', dot: 'bg-amber-500', group: 'stock' },
  out_of_stock: { label: 'Out of stock', dot: 'bg-brand-red', group: 'stock' },
  account: { label: 'Account', dot: 'bg-violet-600', group: 'accounts' },
}
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'sales', label: 'Sales' },
  { key: 'changes', label: 'Edits & voids' },
  { key: 'stock', label: 'Stock' },
  { key: 'accounts', label: 'Accounts' },
]
// sales come all day long: they are listed, but only the other kinds pop up
const POPUP = (n) => n.kind !== 'sale'

const kindOf = (n) => KINDS[n.kind] ?? { label: n.kind, dot: 'bg-gray-400', group: 'all' }

const timeAgo = (iso) => {
  const t = new Date(iso)
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60 && t.toDateString() === new Date().toDateString())
    return t.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  return t.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) +
    ' ' + t.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

function Row({ n, unread, onOpen, onDelete }) {
  const k = kindOf(n)
  return (
    <div className={`group flex border-b border-(color:--border) hover:bg-brand-light ${unread ? 'bg-[#f2faf7]' : 'bg-white'}`}>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="flex min-w-0 flex-1 gap-3 rounded-none border-0 bg-transparent py-3 pr-1 pl-4 text-left"
      >
        <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${k.dot}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`truncate text-[14px] text-gray-900 ${unread ? 'font-bold' : 'font-semibold'}`}>{n.title}</span>
            {n.amount != null && (
              <span className="ml-auto shrink-0 text-[13px] font-semibold text-gray-900 tabular-nums">{peso(n.amount)}</span>
            )}
          </span>
          {n.body && <span className="mt-0.5 block text-[13px] break-words text-gray-700">{n.body}</span>}
          <span className="mt-0.5 block text-[12px] text-gray-500">
            {k.label}
            {n.actor_name ? ` · ${n.actor_name}` : ''} · {timeAgo(n.created_at)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="h-8 shrink-0 self-start rounded-md bg-transparent px-3 pt-2 text-[18px] leading-none text-gray-400 hover:text-brand-red"
        aria-label="Delete notification"
        title="Delete"
        onClick={() => onDelete(n)}
      >
        ×
      </button>
    </div>
  )
}

// The panel under the bell: website orders waiting, then the notifications (newest first)
export function NotificationPanel({ items, seenAt, waiting, onOpenWaiting, onOpen, onMarkAllRead, onDelete, onDeleteAll, onClose }) {
  const [filter, setFilter] = useState('all')
  const box = useRef(null)

  // a click outside (not on the bell) or Esc closes the panel
  useEffect(() => {
    const onDown = (e) => {
      if (!box.current || box.current.contains(e.target) || e.target.closest?.('[data-bell]')) return
      if (e.target.closest?.('[aria-modal="true"]')) return // a confirm box opened from the panel
      onClose()
    }
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const shown = items.filter((n) => filter === 'all' || kindOf(n).group === filter)
  const isUnread = (n) => !seenAt || n.created_at > seenAt

  const deleteOne = (n) => onDelete(n.id).catch((e) => alertDialog(e.message, 'Not deleted'))
  const deleteAll = async () => {
    const f = FILTERS.find((x) => x.key === filter)
    const what = filter === 'all' ? 'all notifications' : `all "${f.label}" notifications`
    if (!(await confirmDialog(`Delete ${what}? This cannot be undone.`))) return
    const kinds = filter === 'all' ? null : Object.keys(KINDS).filter((k) => KINDS[k].group === filter)
    onDeleteAll(kinds).catch((e) => alertDialog(e.message, 'Not deleted'))
  }

  return (
    <div
      ref={box}
      className="fixed top-[80px] right-4 z-50 flex max-h-[calc(100vh-100px)] w-[420px] flex-col overflow-hidden rounded-xl border border-(color:--border) bg-white text-left shadow-2xl max-[900px]:top-14 max-[900px]:right-2 max-[900px]:w-[calc(100vw-16px)]"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between gap-2 border-b border-(color:--border) px-4 py-3">
        <h2 className="m-0 text-lg">Notifications</h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-(color:--border) bg-white px-3 py-1 text-[13px] text-brand-pine hover:bg-brand-light"
            onClick={onMarkAllRead}
          >
            Mark all as read
          </button>
          <button
            type="button"
            className="rounded-lg border border-(color:--border) bg-white px-3 py-1 text-[13px] text-brand-red hover:bg-red-50 disabled:opacity-50"
            onClick={deleteAll}
            disabled={shown.length === 0}
          >
            Delete all
          </button>
        </div>
      </div>

      {waiting > 0 && (
        <button
          type="button"
          className="flex items-center justify-between gap-2 rounded-none border-0 border-b border-(color:--border) bg-red-50 px-4 py-2.5 text-left text-[14px] font-semibold text-brand-red hover:bg-red-100"
          onClick={onOpenWaiting}
        >
          {waiting} website order{waiting === 1 ? '' : 's'} waiting for Accept / Reject
          <span aria-hidden="true">→</span>
        </button>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-(color:--border) px-4 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`rounded-full px-3 py-1 text-[13px] ${filter === f.key ? 'bg-brand-pine text-white' : 'border border-(color:--border) bg-white text-gray-700 hover:bg-brand-light'}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="m-0 px-4 py-8 text-center text-[14px] text-gray-500">No notifications yet.</p>
        ) : (
          shown.map((n) => <Row key={n.id} n={n} unread={isUnread(n)} onOpen={onOpen} onDelete={deleteOne} />)
        )}
      </div>
      <p className="m-0 border-t border-(color:--border) px-4 py-2 text-[12px] text-gray-500">
        Sales, voids, edits by staff, stock running low and accounts waiting, from every branch.
      </p>
    </div>
  )
}

// one pop-up; it closes by itself after 8 seconds
function Toast({ n, onDismiss, onOpen }) {
  const k = kindOf(n)
  useEffect(() => {
    const t = setTimeout(() => onDismiss(n.id), 8000)
    return () => clearTimeout(t)
  }, [n.id, onDismiss])
  return (
    <div className="flex gap-3 rounded-xl border border-(color:--border) bg-white p-3 text-left shadow-xl" role="status">
      <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${k.dot}`} aria-hidden="true" />
      <button type="button" className="min-w-0 flex-1 bg-transparent p-0 text-left" onClick={() => onOpen(n)}>
        <span className="block text-[14px] font-semibold text-gray-900">{n.title}</span>
        {n.body && <span className="mt-0.5 block text-[13px] text-gray-700">{n.body}</span>}
        <span className="mt-0.5 block text-[12px] text-gray-500">
          {n.branch ? branchName(n.branch) : k.label}
          {n.actor_name ? ` · ${n.actor_name}` : ''}
        </span>
      </button>
      <button
        type="button"
        className="h-6 shrink-0 bg-transparent px-1 text-[16px] leading-none text-gray-400 hover:text-gray-700"
        aria-label="Close"
        onClick={() => onDismiss(n.id)}
      >
        ×
      </button>
    </div>
  )
}

// Pop-ups at the bottom right for new notifications (not sales)
export function NotificationToasts({ fresh, onDismiss, onOpen }) {
  const shown = fresh.filter(POPUP)
  if (shown.length === 0) return null
  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-[360px] flex-col gap-2 max-[640px]:right-2 max-[640px]:w-[calc(100vw-16px)]">
      {shown.map((n) => (
        <Toast key={n.id} n={n} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  )
}
