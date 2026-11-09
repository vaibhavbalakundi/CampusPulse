-- Faculty expertise and short portfolio for student search.
alter table public.profiles
  add column if not exists expertise text not null default '',
  add column if not exists portfolio text not null default '';

alter table public.profiles
  drop constraint if exists profiles_expertise_len,
  drop constraint if exists profiles_portfolio_len;

alter table public.profiles
  add constraint profiles_expertise_len check (char_length(expertise) <= 400),
  add constraint profiles_portfolio_len check (char_length(portfolio) <= 800);

create or replace function public.update_faculty_profile(
  p_expertise text,
  p_portfolio text,
  p_office text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_expertise text := btrim(coalesce(p_expertise, ''));
  clean_portfolio text := btrim(coalesce(p_portfolio, ''));
  clean_office text := nullif(btrim(coalesce(p_office, '')), '');
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role = 'faculty'
  ) then
    raise exception 'Faculty access required';
  end if;
  if char_length(clean_expertise) > 400 then
    raise exception 'Keep expertise under 400 characters';
  end if;
  if char_length(clean_portfolio) > 800 then
    raise exception 'Keep the portfolio under 800 characters';
  end if;
  if clean_office is not null and char_length(clean_office) > 120 then
    raise exception 'Keep the office location under 120 characters';
  end if;
  update public.profiles
  set expertise = clean_expertise,
      portfolio = clean_portfolio,
      office_location = clean_office
  where id = auth.uid();
end;
$$;

revoke all on function public.update_faculty_profile(text, text, text) from public;
grant execute on function public.update_faculty_profile(text, text, text) to authenticated;
