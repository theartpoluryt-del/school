-- Preserve all lesson history and administrator privileges; remove personal KC membership only.
begin;
update public.school_accompanists a set enabled=false
from public.school_profiles p,
  lateral (select payload from public.school_state order by updated_at desc limit 1) s,
  lateral jsonb_array_elements(s.payload->'employees') e
where p.is_admin and lower(p.username) in ('polurotova.yv','radyuk.os')
  and lower(e->>'username')=lower(p.username) and a.employee_id=e->>'id';
commit;
