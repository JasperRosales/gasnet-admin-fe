-- The admin can delete notifications from the bell (one at a time, or all)
drop policy if exists "Admin deletes notifications" on public.admin_notifications;
create policy "Admin deletes notifications" on public.admin_notifications
  for delete to authenticated using (public.is_admin());
grant delete on public.admin_notifications to authenticated;
