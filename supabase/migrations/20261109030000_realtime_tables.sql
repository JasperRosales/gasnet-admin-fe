-- Realtime: broadcast changes of the business tables, so the admin and staff pages update by
-- themselves when the POS adds a sale, the secretary edits a row, stock or prices change, etc.
-- (Only orders was broadcast before.) Row Level Security still decides who receives each change.
-- Safe to re-run: tables already in the publication are skipped.
do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'stock', 'stock_movements', 'empties_days', 'inventory', 'inventory_remarks',
    'daily_entries', 'monthly_entries', 'ledger_entries', 'pahiram_items', 'pahiram_rows',
    'pahiram_returns', 'tank_returns', 'utang_payments', 'customer_profiles', 'customer_types',
    'lpg_prices', 'branch_prices', 'profiles', 'audit_log'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
