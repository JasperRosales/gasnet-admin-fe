-- DEMO SALES for screenshots / presentation. Not a migration.
-- Replaces every order with realistic sales for all 7 branches from 2026-08-01 up to now:
--   * sizes: households buy mostly 11kg but also plenty of 2.7kg and 22kg (some 50kg);
--     commercial customers buy mostly 22kg and 50kg
--   * payment: mostly cash, GCash is rare (~5%), some Utang (mostly commercial / RTO accounts);
--     older Utang is usually paid already (Bayad Utang)
--   * expenses: typed in the first sale of each branch-day (orders.remarks), like the staff do:
--     the daily refill payment to the plant (yesterday's empties, at dealer cost: the biggest expense),
--     weekly sahod, monthly renta / kuryente / tubig / internet / SSS-PhilHealth,
--     daily meryenda and delivery gasolina (diesel for the Truck), supplies and the odd repair
--   * busier on weekends and at mid-morning / late afternoon, slowly growing toward November
-- Safe to re-run: it deletes the orders first. Audit rows are not written for the seed.

begin;

alter table public.orders disable trigger audit_log_trigger;
delete from public.orders;

select setseed(0.2026);

with branch_day as (
  select d::date as day, b.id as branch,
    greatest(2, round(b.base
      * case extract(month from d) when 8 then 0.92 when 9 then 0.97 when 10 then 1.0 else 1.06 end
      * case when extract(isodow from d) in (6, 7) then 1.25 else 1 end
      * (0.75 + random() * 0.5)))::int as n
  from generate_series(date '2026-08-01', (now() at time zone 'Asia/Manila')::date, interval '1 day') d
  cross join (values (1, 12), (2, 9), (3, 8), (4, 7), (5, 7), (6, 8), (7, 11)) b(id, base)
),
sale as (
  select bd.day, bd.branch,
    random() as r_type, random() as r_size, random() as r_qty, random() as r_src, random() as r_deliv,
    random() as r_pay, random() as r_paid, random() as r_disc, random() as r_name, random() as r_hour,
    random() as r_min
  from branch_day bd cross join lateral generate_series(1, bd.n) g(k)
),
typed as (
  select s.*,
    case when r_type < 0.22 then 'commercial' when r_type < 0.27 then 'rto' else 'household' end as ctype,
    ((s.day + make_time(
        (array[7,8,8,9,9,9,10,10,10,11,11,12,13,14,15,15,16,16,16,17,17,18])[1 + floor(r_hour * 22)::int],
        floor(r_min * 60)::int, 0)) at time zone 'Asia/Manila') as at
  from sale s
),
lined as (
  select t.*,
    case
      when ctype = 'commercial' then
        case when r_size < 0.04 then '2.7kg' when r_size < 0.42 then '11kg' when r_size < 0.80 then '22kg' else '50kg' end
      else
        case when r_size < 0.24 then '2.7kg' when r_size < 0.76 then '11kg' when r_size < 0.97 then '22kg' else '50kg' end
    end as size,
    case
      when ctype = 'commercial' then 1 + floor(r_qty * 3)::int
      when r_qty < 0.08 then 2 else 1
    end as qty,
    case when r_src < case when ctype = 'commercial' then 0.5 else 0.15 end then 'phone' else 'walkin' end as src
  from typed t
  where t.at <= now()
),
priced as (
  select l.*, coalesce(bp.price, p.price) as price,
    case
      when ctype = 'commercial' and r_disc < 0.3 then 20 * qty
      when ctype <> 'commercial' and r_disc < 0.04 then 20
      else 0
    end as disc,
    case
      when ctype = 'commercial' then
        (array['Carinderia ni Aling Nena','Lomihan sa Bayan','Kainan sa Kanto','Bakery ni Mang Tonyo',
               'Lutong Bahay ni Aling Rosa','JM Eatery','Balayan Lechon House','Sari-sari ni Aling Pacing',
               'Goto ni Mang Ben','Tapsihan sa Plaza'])[1 + floor(r_name * 10)::int]
      when ctype = 'rto' then
        (array['RTO Juan Dela Cruz','RTO Ramon Villanueva','RTO Elena Bautista','RTO Mario Aquino'])[1 + floor(r_name * 4)::int]
      when r_name < 0.55 then 'Walk-in'
      else
        (array['Maria Santos','Jose Reyes','Ana Cruz','Pedro Garcia','Liza Mendoza','Ramon Dizon','Grace Villanueva',
               'Mark Bautista','Joy Ramos','Carlo Mendoza','Nena Castillo','Arnel Panganiban','Rowena Aguilar',
               'Dante Marquez','Lorna De Leon','Jun Hernandez','Cecilia Torres','Rey Manalo','Mila Garcia','Boyet Perez'])
          [1 + floor((r_name - 0.55) / 0.45 * 20)::int]
    end as cname,
    -- utang: mostly commercial / RTO accounts that the branch knows
    r_pay < case ctype when 'commercial' then 0.15 when 'rto' then 0.12 else 0.03 end as is_utang
  from lined l
  join public.lpg_prices p on p.size = l.size
  left join public.branch_prices bp on bp.branch = l.branch and bp.size = l.size
)
insert into public.orders (group_id, created_at, accepted_at, branch, customer_name, customer_type,
  customer_address, item_name, quantity, unit_price, discount, status, source, delivery_status,
  paid_gcash, utang_status, utang_amount, borrowed_tank, remarks)
select gen_random_uuid(), at, at, branch,
  case when is_utang and cname = 'Walk-in' then 'Rodel Santos' else cname end,
  ctype,
  case when src = 'phone' or r_deliv < 0.08 then
    (array['Brgy. Poblacion','Brgy. Caloocan','Brgy. Gulod','Brgy. Lumbangan','Brgy. Sambat','Brgy. Bayan',
           'Brgy. Banaba','Brgy. San Isidro'])[1 + floor(r_deliv * 1000)::int % 8] || ', Balayan' end,
  'LPG Cylinder ' || size, qty, price, disc, 'accepted', src,
  -- every accepted order ends 'delivered' (towngaz: a counter sale is handed over right away);
  -- the walk-ins that were delivered have an address, the counter sales do not
  'delivered',
  -- GCash is rare: about 1 in 20 of the sales that are not Utang
  not is_utang and r_pay > 0.95,
  case
    when not is_utang then null
    when day < (now() at time zone 'Asia/Manila')::date - 10 and r_paid < 0.8 then 'bayad_utang'
    else 'utang'
  end,
  case when is_utang then price * qty - disc end,
  false, null
from priced;

-- expenses: written on the first sale of each branch-day, the way staff type them in the Expenses column.
-- Refill: each morning the branch sends yesterday's empties to the plant (see empties_days below) and
-- pays for the refills at dealer cost (about 84% of the selling price), so the margin is a realistic 6-9%.
update public.orders o
set remarks = e.txt
from (
  select f.id, concat_ws(' ',
      case when f.refill > 0 then 'refill ' || f.refill::int end,
      'meryenda ' || (100 + floor(random() * 11) * 10)::int,
      case when f.branch = 7 then 'diesel ' || (900 + floor(random() * 7) * 100)::int
           else 'gasolina ' || (150 + floor(random() * 5) * 50)::int end,
      case when extract(isodow from f.day) = 6 then 'sahod ' || (case when f.branch = 7 then 9000 else 6600 end
           + floor(random() * 4) * 300)::int end,
      case when extract(day from f.day) = 5 then 'kuryente ' || (2200 + floor(random() * 14) * 100)::int end,
      case when extract(day from f.day) = 5 and f.branch <> 7 then 'tubig ' || (250 + floor(random() * 5) * 50)::int end,
      case when extract(day from f.day) = 10 then 'sss-philhealth ' || (case when f.branch = 7 then 3600 else 2400 end) end,
      case when extract(day from f.day) = 15 and f.branch <> 7 then 'renta ' || (array[12000, 9000, 8000, 7500, 7500, 8500, 0])[f.branch] end,
      case when extract(day from f.day) = 15 and f.branch = 7 then 'truck maintenance ' || (2500 + floor(random() * 6) * 500)::int end,
      case when extract(day from f.day) = 20 and f.branch <> 7 then 'internet 1299' end,
      case when extract(isodow from f.day) = 3 then 'supplies ' || (150 + floor(random() * 8) * 50)::int end,
      case when random() < 0.03 then 'repair ' || (500 + floor(random() * 16) * 100)::int end
    ) as txt
  from (
    select distinct on (o1.branch, (o1.created_at at time zone 'Asia/Manila')::date)
      o1.id, o1.branch, (o1.created_at at time zone 'Asia/Manila')::date as day,
      -- dealer cost of the cylinders sold the day before
      (select coalesce(sum(o2.quantity * case o2.item_name
                when 'LPG Cylinder 2.7kg' then 335 when 'LPG Cylinder 11kg' then 1080
                when 'LPG Cylinder 22kg' then 2160 else 4620 end), 0)
         from public.orders o2
        where o2.branch = o1.branch
          and (o2.created_at at time zone 'Asia/Manila')::date = (o1.created_at at time zone 'Asia/Manila')::date - 1
      ) as refill
    from public.orders o1
    order by o1.branch, (o1.created_at at time zone 'Asia/Manila')::date, o1.created_at
  ) f
) e
where o.id = e.id;

alter table public.orders enable trigger audit_log_trigger;

-- empties: each morning the branch sends the previous day's empties out for refill, so only a
-- day's worth (plus a small starting pile) is on hand. Without this every tank sold since
-- August would still count as an empty at the branch.
alter table public.empties_days disable trigger audit_log_trigger;
delete from public.empties_days;
insert into public.empties_days (branch, day, size, beginning, sent_out)
select b.id, d::date, p.size,
  case when d::date = date '2026-08-01'
       then case p.size when '2.7kg' then 3 when '11kg' then 12 when '22kg' then 3 else 1 end end,
  coalesce((
    select sum(o.quantity)::int from public.orders o
    where o.branch = b.id and o.item_name = 'LPG Cylinder ' || p.size
      and (o.accepted_at at time zone 'Asia/Manila')::date = d::date - 1
  ), 0)
from generate_series(date '2026-08-01', (now() at time zone 'Asia/Manila')::date, interval '1 day') d
cross join generate_series(1, 7) b(id)
cross join public.lpg_prices p;
alter table public.empties_days enable trigger audit_log_trigger;

commit;
