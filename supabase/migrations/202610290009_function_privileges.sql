-- Supabase default privileges can grant anon explicitly, independently of PUBLIC.
-- App RPCs remain executable by authenticated callers and perform role checks.
revoke execute on function public.current_institution(), public.is_institution_admin(),
  public.set_availability(text,integer), public.create_meeting_request(uuid,text,text),
  public.respond_to_request(uuid,text,text), public.cancel_meeting_request(uuid),
  public.mark_notifications_read(), public.add_office_hour(integer,time,time,text),
  public.remove_office_hour(uuid), public.admin_update_profile(uuid,text,text,text,boolean),
  public.schedule_status(text,timestamptz,timestamptz), public.cancel_scheduled_status(),
  public.admin_create_profile(uuid,text,text,text), public.admin_usage_summary(),
  public.admin_import_profiles(jsonb)
  from public, anon;

-- Trigger functions are invoked by the database, not by app users.
revoke execute on function public.audit_request_change(), public.audit_profile_change()
  from public, anon, authenticated;
