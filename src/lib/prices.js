import { supabase } from './supabaseClient'
import { cachedQuery, invalidate } from './lazyData'

// Prices and sizes change rarely, but almost every page needs them: keep them for 5 minutes
// instead of asking Supabase on every page open. Saving a price clears them (see clearPrices).
const TTL = 5 * 60 * 1000

// every size with its normal price and low-stock level, in display order ({ data, error })
export const lpgPrices = () =>
  cachedQuery('prices:lpg', TTL, () => supabase.from('lpg_prices').select('*').order('sort_order'))

// one branch's own prices ({ data, error })
export const branchPrices = (branch) =>
  cachedQuery(`prices:branch:${branch}`, TTL, () =>
    supabase.from('branch_prices').select('size, price').eq('branch', branch),
  )

export const clearPrices = () => invalidate('prices:')
