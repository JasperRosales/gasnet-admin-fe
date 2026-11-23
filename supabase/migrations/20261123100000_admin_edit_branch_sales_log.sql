-- The admin can edit the Daily Sales Log of every branch (staff: only their own branch).
-- staff_branch() is 1 (Caloocan) for the admin, so the order functions below take the branch
-- from the order itself when the admin calls them, and add_manual_orders takes the branch to add
-- to (p_branch). Applied to the AsperTheGhost replica only.

CREATE OR REPLACE FUNCTION public.edit_order(p_order_id bigint, p_name text, p_remarks text, p_delivery_status text, p_discount numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
  new_delivery text;
  new_discount numeric;
begin
  if my_branch is null then raise exception 'Only approved staff can edit orders'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Customer name is required'; end if;

  select * into o from public.orders
  where id = p_order_id and (branch = my_branch or public.is_admin()) for update;
  if not found then raise exception 'Order not found'; end if;
  my_branch := o.branch; -- the admin works on the order's own branch

  new_delivery := o.delivery_status;
  if o.status = 'accepted' then
    if p_delivery_status not in ('preparing', 'out_for_delivery', 'delivered') then
      raise exception 'Invalid delivery status';
    end if;
    new_delivery := p_delivery_status;
  end if;

  new_discount := coalesce(o.discount, 0);
  if p_discount is not null then
    if p_discount < 0 then
      raise exception 'Discount cannot be negative';
    end if;
    if p_discount <> round(p_discount, 2) then
      raise exception 'Discount can have at most 2 decimal places';
    end if;
    if p_discount >= o.quantity * o.unit_price then
      raise exception 'Discount must be less than the order amount';
    end if;
    new_discount := p_discount;
  end if;

  update public.orders
  set customer_name = trim(p_name),
      remarks = nullif(trim(coalesce(p_remarks, '')), ''),
      delivery_status = new_delivery,
      discount = new_discount
  where id = o.id;

  perform public.log_staff_activity(
    my_branch, 'Edited order',
    'Order #' || o.id::text || ' (' || o.item_name || ')'
      || case when new_delivery <> o.delivery_status
              then ': delivery status changed to ' || new_delivery
              else '' end
      || case when new_discount <> coalesce(o.discount, 0)
              then '; discount set to ₱' || to_char(new_discount, 'FM999,999,990.00')
              else '' end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
begin
  if my_branch is null then raise exception 'Only approved staff can delete orders'; end if;

  select * into o from public.orders
  where id = p_order_id and (branch = my_branch or public.is_admin()) for update;
  if not found then raise exception 'Order not found'; end if;
  my_branch := o.branch; -- the admin works on the order's own branch

  -- a deleted order never happened: its tanks go back on the order's own day and time, so its
  -- sale and the return cancel out there (and no other day shows them as Incoming/Refill)
  if o.status = 'accepted' then
    perform public.inv_apply(
      o.branch, o.item_name, o.quantity, 'normal', least(coalesce(o.accepted_at, now()), now())
    );
  end if;

  delete from public.orders where id = o.id;

  perform public.log_staff_activity(
    my_branch, 'Deleted order',
    'Order #' || o.id::text || ': ' || o.quantity::text || ' x ' || o.item_name
      || ' for ' || coalesce(o.customer_name, 'customer')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_row_quantity(p_order_ids bigint[], p_size text, p_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  item text := 'LPG Cylinder ' || p_size;
  base public.orders;
  existing public.orders;
  s public.stock;
  diff integer;
  grp uuid;
  new_id bigint;
  moved_at timestamptz;
begin
  if my_branch is null then raise exception 'Only approved staff can change orders'; end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantity must be a whole number (0 or more)';
  end if;
  if not exists (select 1 from public.lpg_prices where size = p_size) then
    raise exception 'Invalid size';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'No order selected';
  end if;

  -- the admin works on the branch of the row's orders
  if public.is_admin() then
    select branch into my_branch from public.orders where id = any (p_order_ids) order by id limit 1;
    if not found then raise exception 'Order not found'; end if;
  end if;

  -- the first order of the row: its customer details are copied to a new size
  select * into base from public.orders
  where id = any (p_order_ids) and branch = my_branch
  order by id limit 1;
  if not found then raise exception 'Order not found'; end if;

  select * into existing from public.orders
  where id = any (p_order_ids) and branch = my_branch and item_name = item
  for update;

  -- ---- the row already has this size ----
  if found then
    diff := p_quantity - existing.quantity;
    if diff = 0 then return; end if;

    if p_quantity = 0 then
      if array_length(p_order_ids, 1) = 1 then
        raise exception 'This is the only size of the order. Use Delete to remove the whole order.';
      end if;
      perform public.delete_order(existing.id);
      return;
    end if;

    if coalesce(existing.discount, 0) >= p_quantity * existing.unit_price then
      raise exception 'The discount would be more than the new amount. Lower the discount first.';
    end if;

    if existing.status = 'accepted' then
      select * into s from public.stock where branch = my_branch and item_name = item for update;
      if not found then raise exception 'This size is not in stock'; end if;
      if diff > 0 and s.quantity < diff then
        raise exception 'Not enough stock for % (only % left)', p_size, s.quantity;
      end if;
      -- the stock change is dated on the day of the order
      moved_at := least(coalesce(existing.accepted_at, now()), now());
      perform set_config('towngaz.skip_movement', '1', true);
      update public.stock set quantity = quantity - diff where id = s.id;
      perform set_config('towngaz.skip_movement', '0', true);
      insert into public.stock_movements (branch, item_name, change, created_at, kind)
      values (my_branch, item, -diff, moved_at, 'normal');
    end if;

    update public.orders set quantity = p_quantity where id = existing.id;

    perform public.log_staff_activity(
      my_branch, 'Changed order quantity',
      'Order #' || existing.id::text || ' (' || item || ') for '
        || coalesce(existing.customer_name, 'customer') || ': '
        || existing.quantity::text || ' -> ' || p_quantity::text
    );
    perform public.check_restock(my_branch, p_size);
    return;
  end if;

  -- ---- a new size for this row ----
  if p_quantity = 0 then return; end if;

  select * into s from public.stock where branch = my_branch and item_name = item for update;
  if not found then raise exception '% is not in stock', p_size; end if;

  if base.status = 'accepted' then
    if s.quantity < p_quantity then
      raise exception 'Not enough stock for % (only % left)', p_size, s.quantity;
    end if;
    moved_at := least(coalesce(base.accepted_at, now()), now());
    perform set_config('towngaz.skip_movement', '1', true);
    update public.stock set quantity = quantity - p_quantity where id = s.id;
    perform set_config('towngaz.skip_movement', '0', true);
    insert into public.stock_movements (branch, item_name, change, created_at, kind)
    values (my_branch, item, -p_quantity, moved_at, 'normal');
  end if;

  -- the row becomes (or stays) a multiple order: all its sizes share one group
  grp := base.group_id;
  if grp is null then
    grp := gen_random_uuid();
    update public.orders set group_id = grp where id = any (p_order_ids) and branch = my_branch;
  end if;

  insert into public.orders
    (customer_id, branch, item_name, quantity, unit_price, discount, customer_type,
     customer_name, customer_address, customer_contact, remarks, utang_status,
     status, delivery_status, accepted_at, source, group_id, created_at)
  values
    (base.customer_id, my_branch, item, p_quantity, s.price, 0, base.customer_type,
     base.customer_name, base.customer_address, base.customer_contact, base.remarks, base.utang_status,
     base.status, base.delivery_status, base.accepted_at, base.source, grp, base.created_at)
  returning id into new_id;

  perform public.log_staff_activity(
    my_branch, 'Added size to order',
    'Order #' || new_id::text || ': ' || p_quantity::text || ' x ' || item
      || ' for ' || coalesce(base.customer_name, 'customer')
  );
  perform public.check_restock(my_branch, p_size);
end;
$function$;

drop function if exists public.add_manual_orders(jsonb, text, text, text, text, text, text, numeric, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.add_manual_orders(p_items jsonb, p_name text, p_address text, p_contact text, p_customer_type text, p_source text, p_remarks text DEFAULT NULL::text, p_discount numeric DEFAULT 0, p_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_branch smallint DEFAULT NULL::smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  rule public.customer_types;
  disc numeric := coalesce(p_discount, 0);
  when_at timestamptz := now();
  grp uuid := gen_random_uuid();
  it jsonb;
  v_size text;
  v_qty integer;
  s public.stock;
  total_amount numeric := 0;
  allocated numeric := 0;
  biggest_idx integer := 1;
  biggest_amount numeric := -1;
  n integer;
  sizes text[] := '{}';
  qtys integer[] := '{}';
  prices numeric[] := '{}';
  amounts numeric[] := '{}';
  discs numeric[] := '{}';
  summary text := '';
begin
  if my_branch is null then raise exception 'Only approved staff can add orders'; end if;
  -- the admin can add to any branch; staff only to their own
  if p_branch is not null and p_branch <> my_branch then
    if not public.is_admin() then raise exception 'You can only add orders to your own branch'; end if;
    if not exists (select 1 from public.stock where branch = p_branch) then raise exception 'Unknown branch'; end if;
    my_branch := p_branch;
  end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Customer name is required'; end if;
  if p_address is null or trim(p_address) = '' then raise exception 'Address is required'; end if;
  if p_contact is null or trim(p_contact) = '' then raise exception 'Contact number is required'; end if;
  if p_source not in ('phone', 'walkin') then raise exception 'Please choose phone or walk-in'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Please enter a quantity for at least one size';
  end if;

  select * into rule from public.customer_types where type = p_customer_type;
  if not found then raise exception 'Please choose a customer type'; end if;

  -- check every size: valid, entered once, a whole quantity, enough stock (the rows are locked)
  for it in select value from jsonb_array_elements(p_items) loop
    v_size := it->>'size';
    v_qty := nullif(it->>'quantity', '')::integer;
    if v_qty is null or v_qty < 1 then
      raise exception 'Quantity must be a whole number of at least 1';
    end if;
    if v_size = any(sizes) then
      raise exception 'Each size can only be entered once';
    end if;
    if not exists (select 1 from public.lpg_prices where size = v_size) then
      raise exception 'Invalid size';
    end if;

    select * into s from public.stock
    where branch = my_branch and item_name = 'LPG Cylinder ' || v_size for update;
    if not found then raise exception '% is not in stock', v_size; end if;
    if s.quantity < v_qty then
      raise exception 'Not enough stock for % (only % left)', v_size, s.quantity;
    end if;

    sizes := sizes || v_size;
    qtys := qtys || v_qty;
    prices := prices || s.price;
    amounts := amounts || (s.price * v_qty);
    total_amount := total_amount + s.price * v_qty;
  end loop;

  -- the discount is for the whole order of the customer; it is split between the sizes
  if disc < 0 then raise exception 'Discount cannot be negative'; end if;
  if disc <> round(disc, 2) then raise exception 'Discount can have at most 2 decimal places'; end if;

  n := array_length(sizes, 1);
  if disc > 0 then
    if disc >= total_amount then raise exception 'Discount must be less than the order amount'; end if;
    for i in 1..n loop
      discs := discs || round(disc * amounts[i] / total_amount, 2);
      allocated := allocated + discs[i];
      if amounts[i] > biggest_amount then
        biggest_amount := amounts[i];
        biggest_idx := i;
      end if;
    end loop;
    discs[biggest_idx] := discs[biggest_idx] + (disc - allocated);
    for i in 1..n loop
      if discs[i] < 0 or discs[i] >= amounts[i] then
        raise exception 'Discount is too large for one of the sizes. Please enter a smaller discount.';
      end if;
    end loop;
  else
    for i in 1..n loop
      discs := discs || 0::numeric;
    end loop;
  end if;

  -- the time of the order: today, or a past day (to catch up on a day the system was not used),
  -- never in the future. The staff can go back up to 7 days; the admin any day.
  if p_time is not null and p_time <= now() then
    if not public.is_admin()
       and (p_time at time zone 'Asia/Manila')::date < (now() at time zone 'Asia/Manila')::date - 7 then
      raise exception 'Orders can only be added up to 7 days back. Ask the admin to add older orders.';
    end if;
    when_at := p_time;
  end if;

  for i in 1..n loop
    -- the stock goes down, and the sale is recorded at the time of the order (also on a past
    -- day), so the Stock Inventory of that day counts it
    perform public.inv_apply(my_branch, 'LPG Cylinder ' || sizes[i], -qtys[i], 'normal', when_at);

    insert into public.orders
      (customer_id, branch, item_name, quantity, unit_price, discount, customer_type,
       customer_name, customer_address, customer_contact, remarks,
       status, delivery_status, accepted_at, source, group_id)
    values
      (null, my_branch, 'LPG Cylinder ' || sizes[i], qtys[i], prices[i], discs[i], p_customer_type,
       trim(p_name), trim(p_address), trim(p_contact), nullif(trim(coalesce(p_remarks, '')), ''),
       'accepted', 'preparing', when_at, p_source, grp);

    summary := summary || qtys[i]::text || ' x ' || sizes[i] || ', ';
    perform public.check_restock(my_branch, sizes[i]);
  end loop;

  perform public.log_staff_activity(
    my_branch, 'Added manual order',
    'For ' || trim(p_name) || ': ' || rtrim(summary, ', ')
      || ' (' || case p_source when 'phone' then 'phone order' else 'walk-in order' end
      || ', ' || rule.label
      || case when disc > 0 then ', discount ₱' || to_char(disc, 'FM999,999,990.00') else '' end
      || ')'
  );
end;
$function$;

revoke all on function public.add_manual_orders(jsonb, text, text, text, text, text, text, numeric, timestamp with time zone, smallint) from public, anon;
grant execute on function public.add_manual_orders(jsonb, text, text, text, text, text, text, numeric, timestamp with time zone, smallint) to authenticated, service_role;
