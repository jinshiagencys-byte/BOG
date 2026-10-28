-- ============================================================================
-- V2 — 11 — Preuves vidéo QA (Supabase Storage)
--
-- Les runs Playwright/WebMCP enregistrent une vidéo par cas. Elle est déposée
-- dans un bucket privé par la fonction `upload-evidence` (service role) puis
-- lue dans l'application via une URL signée.
--
-- Chemin : <org_id>/<run_id>/<CODE>.webm
-- La policy de lecture vérifie l'appartenance à l'organisation du premier
-- segment, donc un membre ne peut pas lire la preuve d'une autre org.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'qa-evidence',
  'qa-evidence',
  false,
  26214400, -- 25 Mo : une vidéo de cas dure quelques secondes
  array['video/webm', 'video/mp4']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Aucune policy d'écriture : seul le service role dépose des fichiers.
drop policy if exists "qa_evidence_member_read" on storage.objects;
create policy "qa_evidence_member_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'qa-evidence'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.is_org_member(((storage.foldername(name))[1])::uuid)
      else false
    end
  );
