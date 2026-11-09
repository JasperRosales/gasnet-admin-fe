-- DEMO DATA for screenshots / presentation. Not a migration.
-- Fills stock and ~6 weeks of accepted sales for all 7 branches, plus a few customers and audit rows.
-- The database had no orders, customers or audit rows before this seed (2026-11-09). To remove:
--   delete from public.orders; delete from public.customer_profiles where address like '%(demo)';
--   delete from public.audit_log where actor_id is null; update public.stock set quantity = 0;

select setseed(0.42);

-- current stock (some sizes under their low-stock level so the alerts show)
update public.stock s set quantity = v.q
from (values
  (1,'2.7kg',3),(1,'11kg',42),(1,'22kg',9),(1,'50kg',1),
  (2,'2.7kg',14),(2,'11kg',35),(2,'22kg',4),(2,'50kg',5),
  (3,'2.7kg',11),(3,'11kg',8),(3,'22kg',12),(3,'50kg',3),
  (4,'2.7kg',18),(4,'11kg',27),(4,'22kg',7),(4,'50kg',2),
  (5,'2.7kg',2),(5,'11kg',31),(5,'22kg',10),(5,'50kg',4),
  (6,'2.7kg',9),(6,'11kg',22),(6,'22kg',6),(6,'50kg',3),
  (7,'2.7kg',20),(7,'11kg',60),(7,'22kg',15),(7,'50kg',6)
) as v(b, size, q)
where s.branch = v.b and s.item_name = 'LPG Cylinder ' || v.size;

-- past sales: 42 days back up to yesterday, every branch
with days as (
  select d::date as day from generate_series(current_date - 42, current_date - 1, interval '1 day') d
),
sales as (
  select gen_random_uuid() as group_id, b.id as branch, days.day,
    -- busier on weekends, busier main branch and truck
    generate_series(1, (4 + floor(random() * 6)
      + case when extract(dow from days.day) in (0, 6) then 3 else 0 end
      + case when b.id in (1, 7) then 4 else 0 end)::int) as n
  from days cross join generate_series(1, 7) b(id)
),
lines as (
  select s.*,
    case when r < 0.18 then '2.7kg' when r < 0.80 then '11kg' when r < 0.95 then '22kg' else '50kg' end as size,
    random() as r2, random() as r3, random() as r4,
    (s.day + time '07:30' + (random() * interval '11 hours')) at time zone 'Asia/Manila' as at
  from sales s, lateral (select random() as r) x
)
insert into public.orders (group_id, created_at, accepted_at, branch, customer_name, customer_type,
  item_name, quantity, unit_price, discount, total_price, status, source, delivery_status,
  paid_gcash, borrowed_tank, borrowed_qty, remarks)
select l.group_id, l.at, l.at, l.branch,
  (array['Walk-in','Maria Santos','Jose Reyes','Ana Cruz','Carinderia ni Aling Nena','Lomihan sa Bayan','Pedro Garcia','Liza Mendoza'])[1 + floor(l.r3 * 8)::int],
  case when l.r2 < 0.22 then 'commercial' else 'walkin' end,
  'LPG Cylinder ' || l.size,
  case when l.r2 < 0.22 then 2 + floor(l.r4 * 3)::int else 1 end,
  coalesce(bp.price, p.price),
  case when l.r4 < 0.08 then 50 else 0 end,
  coalesce(bp.price, p.price) * case when l.r2 < 0.22 then 2 + floor(l.r4 * 3)::int else 1 end
    - case when l.r4 < 0.08 then 50 else 0 end,
  'accepted', 'walkin',
  case when l.r3 < 0.3 then 'delivered' else null end,
  l.r4 > 0.7, false, 0, null
from lines l
join public.lpg_prices p on p.size = l.size
left join public.branch_prices bp on bp.branch = l.branch and bp.size = l.size;

-- today's sales so far at Caloocan (shows in the POS "Today's sales" and can be reprinted)
insert into public.orders (group_id, created_at, accepted_at, branch, customer_name, customer_type,
  item_name, quantity, unit_price, discount, total_price, status, source, delivery_status, paid_gcash, remarks)
select g, t, t, 1, n, ct, 'LPG Cylinder ' || sz, q, pr, d, pr * q - d, 'accepted', 'walkin', ds, gc, null
from (values
  (gen_random_uuid(), now() - interval '3 hours', 'Maria Santos', 'walkin', '11kg', 1, 1285.00, 0, null, false),
  (gen_random_uuid(), now() - interval '2 hours', 'Carinderia ni Aling Nena', 'commercial', '22kg', 2, 2570.00, 100, 'delivered', true),
  (gen_random_uuid(), now() - interval '50 minutes', 'Walk-in', 'walkin', '2.7kg', 1, 395.00, 0, null, false)
) v(g, t, n, ct, sz, q, pr, d, ds, gc);

insert into public.customer_profiles (branch, full_name, address, contact) values
  (1, 'Maria Santos', 'Brgy. Caloocan, Balayan (demo)', '09171234567'),
  (1, 'Carinderia ni Aling Nena', 'Poblacion, Balayan (demo)', '09281234567'),
  (2, 'Jose Reyes', 'Bayan, Balayan (demo)', '09191234567'),
  (3, 'Ana Cruz', 'Gulod, Calatagan (demo)', '09351234567'),
  (4, 'Lomihan sa Bayan', 'Cuenca, Batangas (demo)', '09451234567'),
  (5, 'Pedro Garcia', 'Sta. Teresita, Batangas (demo)', '09561234567');

insert into public.audit_log (created_at, actor_name, actor_role, branch, action, table_name, changed_columns, old_data, new_data)
values
  (now() - interval '5 hours', 'Admin', 'admin', 1, 'UPDATE', 'lpg_prices', array['price'], '{"size":"11kg","price":1265}', '{"size":"11kg","price":1285}'),
  (now() - interval '3 hours', 'Caloocan Staff', 'staff', 1, 'INSERT', 'orders', null, null, '{"item_name":"LPG Cylinder 11kg","quantity":1}'),
  (now() - interval '2 hours', 'Caloocan Staff', 'staff', 1, 'INSERT', 'orders', null, null, '{"item_name":"LPG Cylinder 22kg","quantity":2}'),
  (now() - interval '90 minutes', 'Bayan Staff', 'staff', 2, 'UPDATE', 'stock', array['quantity'], '{"quantity":10}', '{"quantity":35}'),
  (now() - interval '1 hour', 'Gulod Staff', 'staff', 3, 'INSERT', 'orders', null, null, '{"item_name":"LPG Cylinder 2.7kg","quantity":1}');
