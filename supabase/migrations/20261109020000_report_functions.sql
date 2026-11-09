-- Read-only report functions the admin portal calls (see schema.md, "RPC functions").
-- They are worked out from orders and stock; nothing is stored.

-- Filled cylinders of a branch between p_from and p_to, one row per size.
-- Ending is worked back from the current stock: stock now + what was sold after p_to.
create or replace function public.inventory_report(p_branch smallint, p_from timestamptz, p_to timestamptz)
returns table (
  size text, beginning integer, incoming integer, refill integer, swap_in integer, total integer,
  sold integer, orders_sold integer, ending integer, actual integer, variance integer, buy integer,
  remarks text
)
language sql stable security definer set search_path = '' as $$
  with s as (
    select p.size, p.sort_order, coalesce(st.quantity, 0) as now_qty
    from public.lpg_prices p
    left join public.stock st on st.branch = p_branch and st.item_name = 'LPG Cylinder ' || p.size
  ),
  o as (
    select replace(item_name, 'LPG Cylinder ', '') as size,
      sum(quantity) filter (where accepted_at >= p_from and accepted_at < p_to) as sold,
      count(*) filter (where accepted_at >= p_from and accepted_at < p_to) as n,
      sum(quantity) filter (where accepted_at >= p_to) as sold_after
    from public.orders
    where branch = p_branch and status = 'accepted' and accepted_at >= p_from
    group by 1
  )
  select s.size,
    (s.now_qty + coalesce(o.sold_after, 0) + coalesce(o.sold, 0))::integer,
    0, 0, 0,
    (s.now_qty + coalesce(o.sold_after, 0) + coalesce(o.sold, 0))::integer,
    coalesce(o.sold, 0)::integer,
    coalesce(o.n, 0)::integer,
    (s.now_qty + coalesce(o.sold_after, 0))::integer,
    null::integer, null::integer, 0, null::text
  from s left join o on o.size = s.size
  where public.is_portal_user()
  order by s.sort_order;
$$;

-- Empty cylinders of a branch on p_day: the empties given back by that day's buyers.
create or replace function public.empties_report(p_branch smallint, p_day date)
returns table (
  size text, beginning integer, incoming integer, refill integer, total integer, sales integer,
  ending integer, actual integer, variance integer, borrowed integer, reject integer,
  sent_out integer, buy integer
)
language sql stable security definer set search_path = '' as $$
  with o as (
    select replace(item_name, 'LPG Cylinder ', '') as size,
      sum(quantity) as sold,
      sum(case when borrowed_tank then greatest(borrowed_qty, 0) else 0 end) as borrowed
    from public.orders
    where branch = p_branch and status = 'accepted'
      and (accepted_at at time zone 'Asia/Manila')::date = p_day
    group by 1
  )
  select p.size, 0, null::integer, 0, null::integer,
    (coalesce(o.sold, 0) - coalesce(o.borrowed, 0))::integer,
    (coalesce(o.sold, 0) - coalesce(o.borrowed, 0))::integer,
    (coalesce(o.sold, 0) - coalesce(o.borrowed, 0))::integer,
    0, coalesce(o.borrowed, 0)::integer, 0, 0, 0
  from public.lpg_prices p left join o on o.size = p.size
  where public.is_portal_user()
  order by p.sort_order;
$$;

-- Filled tanks received per branch and size in a period (no deliveries are recorded yet).
create or replace function public.monthly_receipts(p_from timestamptz, p_to timestamptz)
returns table (branch smallint, size text, quantity integer)
language sql stable security definer set search_path = '' as $$
  select null::smallint, null::text, null::integer where false;
$$;

grant execute on function public.inventory_report(smallint, timestamptz, timestamptz) to authenticated;
grant execute on function public.empties_report(smallint, date) to authenticated;
grant execute on function public.monthly_receipts(timestamptz, timestamptz) to authenticated;
