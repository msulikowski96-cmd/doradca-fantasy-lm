-- Trigger musi działać z uprawnieniami wywołującego, inaczej current_user to zawsze właściciel funkcji.
create or replace function public.protect_profile() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.role is distinct from old.role or new.blocked is distinct from old.blocked
      or new.email is distinct from old.email or new.id is distinct from old.id)
     and current_user = 'authenticated' and not public.is_admin() then
    raise exception 'Tylko admin może zmieniać role i blokady kont.';
  end if;
  if current_user = 'authenticated' and new.id = (select auth.uid()) and old.role = 'admin'
     and (new.role <> 'admin' or new.blocked) then
    raise exception 'Nie możesz odebrać roli admina ani zablokować własnego konta.';
  end if;
  return new;
end $$;
