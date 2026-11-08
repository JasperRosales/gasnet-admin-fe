# Database schema (Supabase `public`)

Taken from the live Supabase project used by
[towngaz-portal](https://github.com/JasperRosales/towngaz-portal).

**How it was collected:** the publishable key can't read the schema endpoint,
so each column name used in the portal code was tested against the REST API.
Types come from Postgres error messages.
Not captured: nullability, defaults, primary/foreign keys, RLS policies,
and any column the portal code never mentions.

Type notes: `json` may be `json` or `jsonb`; the array type may not be `text[]`.

## audit_log
| Column | Type |
|---|---|
| id | bigint |
| created_at | timestamptz |
| actor_id | uuid |
| actor_name | text |
| actor_role | text |
| branch | integer |
| action | text |
| table_name | text |
| changed_columns | array (likely `text[]`) |
| old_data | json |
| new_data | json |

## branch_prices
| Column | Type |
|---|---|
| branch | smallint |
| size | text |
| price | numeric |

## customer_profiles
| Column | Type |
|---|---|
| id | bigint |
| created_at | timestamptz |
| created_by | uuid |
| branch | smallint |
| full_name | text |
| address | text |
| contact | text |

## daily_entries
| Column | Type |
|---|---|
| day | date |
| branch | smallint |
| key | text |
| amount | numeric |
| updated_at | timestamptz |
| updated_by | uuid |

## inventory_remarks
| Column | Type |
|---|---|
| day | date |
| branch | smallint |
| remarks | text |

## lpg_prices
| Column | Type |
|---|---|
| size | text |
| price | numeric |
| sort_order | smallint |
| low_stock_level | integer |

## monthly_entries
| Column | Type |
|---|---|
| month | date (1st of month) |
| branch | smallint |
| key | text |
| amount | numeric |
| updated_at | timestamptz |
| updated_by | uuid |

## orders
| Column | Type | Values seen in code |
|---|---|---|
| id | bigint | |
| group_id | uuid | |
| created_at | timestamptz | |
| accepted_at | timestamptz | |
| branch | smallint | |
| customer_id | uuid | |
| customer_name | text | |
| customer_address | text | |
| customer_contact | text | |
| customer_type | text | e.g. `commercial` |
| item_name | text | LPG size |
| quantity | integer | |
| unit_price | numeric | |
| discount | numeric | |
| total_price | numeric | |
| status | text | `pending`, `accepted`, `rejected` |
| source | text | e.g. `walkin` |
| delivery_status | text | `not_started`, `delivery`, `out_for_delivery`, `delivered` |
| utang_status | text | `utang`, `bayad_utang`, `remark` |
| paid_gcash | boolean | |
| other_income | text | |
| other_income_gcash | boolean | |
| borrowed_tank | boolean | |
| borrowed_qty | integer | |
| remarks | text | |

## profiles
| Column | Type | Values seen in code |
|---|---|---|
| id | uuid | = `auth.users.id` |
| created_at | timestamptz | |
| email | text | |
| full_name | text | |
| address | text | |
| contact_number | text | |
| role | text | `admin`, `manager`, `staff`, `customer` |
| status | text | `pending`, `approved` |
| branch | smallint | |
| customer_type | text | |

## stock
| Column | Type |
|---|---|
| id | bigint |
| created_at | timestamptz |
| branch | smallint |
| item_name | text |
| quantity | integer |
| price | numeric |

## tank_returns
| Column | Type |
|---|---|
| id | bigint |
| order_id | bigint (→ orders.id) |
| branch | smallint |
| size | text |
| quantity | integer |
| returned_at | timestamptz |
| created_by | uuid |

## RPC functions
These are the arguments the portal code passes; the functions may accept more.

| Function | Args |
|---|---|
| accept_order / reject_order | p_order_id |
| delete_account | p_user_id |
| empties_report | p_branch, p_day |
| inventory_report | p_branch, p_from, p_to |
| monthly_receipts | p_from, p_to |
| pahiram_list | p_branch |
| pahiram_add | p_items, p_time |
| pahiram_return | p_row_id, p_returns |
| pahiram_delete | p_row_id |
| record_tank_return | p_order_id, p_quantity |
| undo_tank_return | p_return_id |
| save_empties_day | p_branch, p_day, p_rows |
| save_inventory_day | p_branch, p_from, p_to, p_rows |
| save_inventory_remarks | p_branch, p_day, p_remarks |
| set_borrowed_qty | p_order_id, p_qty |
| set_daily_entry | p_day, p_branch, p_key, p_amount |
| set_monthly_entry | p_month, p_branch, p_key, p_amount |
| set_order_remarks | p_order_ids, p_utang, p_borrowed, p_delivered, p_gcash |
| update_price | p_size, p_price |

Edge function: `recommend` (allowed for staff and admin only).
