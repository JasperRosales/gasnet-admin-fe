-- Notifications for the admin (the bell of the admin portal).
-- Triggers write a row when something happens that the owner should know about:
--   sale       a POS / manual sale (one notification per sale, its lines added together)
--   website    a new website order waiting for Accept / Reject
--   void       a sale voided (POS) or an accepted order rejected
--   edit       an order edited by staff (expenses, discount, quantity, price, name, utang, ...)
--   delete     an order deleted by staff
--   low_stock / out_of_stock   a size at a branch reaches its low stock level / zero
--   account    a staff or manager account waiting for approval
--   log        the Daily Sales Log typed by staff (one per branch and day)
-- The admin's own actions and changes without a logged-in user (SQL, seeds) are not notified,
-- except new accounts (created by the sign-up itself). Only the admin can read them.

create or replace function public.branch_label(p_branch smallint) returns text
language sql immutable set search_path to '' as $$
  select coalesce((array['Caloocan', 'Bayan', 'Gulod', 'Cuenca', 'Sta. Teresita', 'Agoncillo', 'Truck'])[p_branch],
                  'Branch ' || p_branch)
$$;

create table if not exists public.admin_notifications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  branch smallint,
  title text not null,
  body text,
  amount numeric,
  actor_name text,
  link text,           -- the page to open: 'report' (Daily Sales Log), 'inventory', 'accounts'
  ref text unique       -- groups a burst into one notification (for example the lines of one sale)
);
create index if not exists admin_notifications_created_at on public.admin_notifications (created_at desc);

-- the last time each admin opened the notifications (older ones count as read)
create table if not exists public.admin_notification_reads (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.admin_notifications enable row level security;
alter table public.admin_notification_reads enable row level security;

drop policy if exists "Admin reads notifications" on public.admin_notifications;
create policy "Admin reads notifications" on public.admin_notifications
  for select to authenticated using (public.is_admin());

drop policy if exists "Admin keeps own read mark" on public.admin_notification_reads;
create policy "Admin keeps own read mark" on public.admin_notification_reads
  for all to authenticated
  using (user_id = auth.uid() and public.is_admin())
  with check (user_id = auth.uid() and public.is_admin());

revoke all on public.admin_notifications from anon, authenticated;
revoke all on public.admin_notification_reads from anon, authenticated;
grant select on public.admin_notifications to authenticated;
grant select, insert, update on public.admin_notification_reads to authenticated;

-- write one notification. p_ref: rows with the same ref become one notification;
-- p_merge: add the body and amount to it (lines of one sale), otherwise replace them
create or replace function public.notify_admin(
  p_kind text, p_branch smallint, p_title text, p_body text,
  p_amount numeric default null, p_link text default null, p_ref text default null, p_merge boolean default false
) returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_actor text;
begin
  select coalesce(nullif(trim(full_name), ''), email) into v_actor from public.profiles where id = auth.uid();
  insert into public.admin_notifications (kind, branch, title, body, amount, actor_name, link, ref)
  values (p_kind, p_branch, p_title, p_body, p_amount, v_actor, p_link, p_ref)
  on conflict (ref) do update set
    body = case when p_merge then public.admin_notifications.body || ', ' || excluded.body else excluded.body end,
    amount = case when p_merge then coalesce(public.admin_notifications.amount, 0) + coalesce(excluded.amount, 0)
                  else excluded.amount end,
    title = excluded.title,
    actor_name = excluded.actor_name,
    created_at = now();
end $$;
revoke all on function public.notify_admin(text, smallint, text, text, numeric, text, text, boolean) from public, anon, authenticated;

-- ---- orders ----
-- put the customer's name once in front of a (merged) sale notification: "Maria: 1 x 11kg, 1 x 22kg"
create or replace function public.name_notification(p_ref text, p_name text) returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_prefix text := coalesce(nullif(trim(p_name), ''), 'Walk-in') || ': ';
begin
  update public.admin_notifications
  set body = v_prefix || body
  where ref = p_ref and left(body, length(v_prefix)) <> v_prefix;
end $$;
revoke all on function public.name_notification(text, text) from public, anon, authenticated;

create or replace function public.notify_orders() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_size text;
  v_changes text := '';
  v_amount numeric;
begin
  -- changes by the admin, or without a logged-in user (SQL, seeds), are not notified
  if auth.uid() is null or public.is_admin() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_size := new.quantity || ' x ' || replace(new.item_name, 'LPG Cylinder ', '');
    v_amount := new.unit_price * new.quantity - coalesce(new.discount, 0);
    if new.status = 'pending' then
      perform public.notify_admin('website', new.branch,
        'New website order · ' || public.branch_label(new.branch),
        coalesce(new.customer_name, 'Customer') || ': ' || v_size, v_amount, 'report',
        'website:' || coalesce(new.group_id::text, new.id::text), true);
    elsif new.status = 'accepted' then
      perform public.notify_admin('sale', new.branch,
        'Sale · ' || public.branch_label(new.branch)
          || case when new.utang_status = 'utang' then ' · Utang'
                  when new.paid_gcash then ' · GCash' else '' end,
        v_size, v_amount, 'report', 'sale:' || coalesce(new.group_id::text, new.id::text), true);
      perform public.name_notification('sale:' || coalesce(new.group_id::text, new.id::text), new.customer_name);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.notify_admin('delete', old.branch,
      'Order deleted · ' || public.branch_label(old.branch),
      coalesce(old.customer_name, 'Walk-in') || ': ' || old.quantity || ' x '
        || replace(old.item_name, 'LPG Cylinder ', '') || ' (order #' || old.id || ')',
      old.unit_price * old.quantity - coalesce(old.discount, 0), 'report', null, false);
    return old;
  end if;

  -- UPDATE
  if old.status = 'accepted' and new.status = 'cancelled' then
    perform public.notify_admin('void', new.branch,
      'Sale voided · ' || public.branch_label(new.branch),
      new.quantity || ' x ' || replace(new.item_name, 'LPG Cylinder ', ''),
      new.unit_price * new.quantity - coalesce(new.discount, 0), 'report',
      'void:' || coalesce(new.group_id::text, new.id::text), true);
    perform public.name_notification('void:' || coalesce(new.group_id::text, new.id::text), new.customer_name);
    return new;
  end if;
  if old.status <> new.status then
    return new; -- accepting / rejecting website orders is the normal flow
  end if;

  if new.remarks is distinct from old.remarks then
    v_changes := v_changes || '; Expenses: ' || coalesce('"' || nullif(old.remarks, '') || '"', '(none)')
      || ' → ' || coalesce('"' || nullif(new.remarks, '') || '"', '(none)');
  end if;
  if new.discount is distinct from old.discount then
    v_changes := v_changes || '; Discount: ₱' || old.discount || ' → ₱' || new.discount;
  end if;
  if new.quantity is distinct from old.quantity or new.item_name is distinct from old.item_name then
    v_changes := v_changes || '; Item: ' || old.quantity || ' x ' || replace(old.item_name, 'LPG Cylinder ', '')
      || ' → ' || new.quantity || ' x ' || replace(new.item_name, 'LPG Cylinder ', '');
  end if;
  if new.unit_price is distinct from old.unit_price then
    v_changes := v_changes || '; Price: ₱' || old.unit_price || ' → ₱' || new.unit_price;
  end if;
  if new.customer_name is distinct from old.customer_name then
    v_changes := v_changes || '; Name: ' || coalesce(old.customer_name, '-') || ' → ' || coalesce(new.customer_name, '-');
  end if;
  if new.utang_status is distinct from old.utang_status then
    v_changes := v_changes || '; Utang: ' || coalesce(old.utang_status, 'none') || ' → ' || coalesce(new.utang_status, 'none');
  end if;
  if new.paid_gcash is distinct from old.paid_gcash then
    v_changes := v_changes || '; Payment: ' || case when new.paid_gcash then 'Cash → GCash' else 'GCash → Cash' end;
  end if;
  if new.other_income is distinct from old.other_income then
    v_changes := v_changes || '; Other income: ' || coalesce('"' || nullif(old.other_income, '') || '"', '(none)')
      || ' → ' || coalesce('"' || nullif(new.other_income, '') || '"', '(none)');
  end if;

  if v_changes <> '' then
    -- several edits of one order within a minute become one notification
    perform public.notify_admin('edit', new.branch,
      'Order edited · ' || public.branch_label(new.branch),
      coalesce(new.customer_name, 'Walk-in') || ' (order #' || new.id || ')' || v_changes,
      null, 'report', 'edit:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), false);
  end if;
  return new;
end $$;

drop trigger if exists notify_admin_orders on public.orders;
create trigger notify_admin_orders after insert or update or delete on public.orders
  for each row execute function public.notify_orders();

-- ---- stock: a size reaching its low stock level, or running out ----
create or replace function public.notify_stock() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_low integer;
  v_size text := replace(new.item_name, 'LPG Cylinder ', '');
begin
  if auth.uid() is null or new.quantity >= old.quantity then
    return new;
  end if;
  select low_stock_level into v_low from public.lpg_prices where size = v_size;
  if new.quantity <= 0 and old.quantity > 0 then
    perform public.notify_admin('out_of_stock', new.branch,
      'Out of stock · ' || public.branch_label(new.branch),
      v_size || ' has no filled tanks left', null, 'inventory',
      'stock:' || new.branch || ':' || v_size || ':' || (now() at time zone 'Asia/Manila')::date, false);
  elsif v_low is not null and new.quantity <= v_low and old.quantity > v_low then
    perform public.notify_admin('low_stock', new.branch,
      'Low stock · ' || public.branch_label(new.branch),
      v_size || ': ' || new.quantity || ' left (low stock level ' || v_low || ')', null, 'inventory',
      'stock:' || new.branch || ':' || v_size || ':' || (now() at time zone 'Asia/Manila')::date, false);
  end if;
  return new;
end $$;

drop trigger if exists notify_admin_stock on public.stock;
create trigger notify_admin_stock after update of quantity on public.stock
  for each row execute function public.notify_stock();

-- ---- accounts waiting for approval ----
create or replace function public.notify_profiles() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.status = 'pending' and new.role in ('staff', 'manager') then
    perform public.notify_admin('account', new.branch,
      'Account waiting for approval',
      coalesce(nullif(trim(new.full_name), ''), new.email, 'New account') || ' (' || new.role
        || case when new.branch is not null then ', ' || public.branch_label(new.branch) else '' end || ')',
      null, 'accounts', 'account:' || new.id, false);
  end if;
  return new;
end $$;

drop trigger if exists notify_admin_profiles on public.profiles;
create trigger notify_admin_profiles after insert or update of status, role on public.profiles
  for each row execute function public.notify_profiles();

-- ---- the Daily Sales Log typed by staff (one notification per branch and day) ----
create or replace function public.notify_daily_entries() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  perform public.notify_admin('log', new.branch,
    'Daily Sales Log updated · ' || public.branch_label(new.branch),
    to_char(new.day, 'Mon DD') || ': ' || new.key || ' = ' || new.amount, null, 'report',
    'log:' || new.branch || ':' || new.day, false);
  return new;
end $$;

drop trigger if exists notify_admin_daily_entries on public.daily_entries;
create trigger notify_admin_daily_entries after insert or update on public.daily_entries
  for each row execute function public.notify_daily_entries();

-- live updates of the bell
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_notifications') then
    alter publication supabase_realtime add table public.admin_notifications;
  end if;
end $$;
