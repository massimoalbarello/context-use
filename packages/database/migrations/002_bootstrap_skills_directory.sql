-- Skills are a first-class top-level knowledge area, just like automations.
-- Keep this as a forward migration so existing installations receive the
-- directory without changing the checksum of the applied baseline migration.
INSERT INTO knowledge_directories(
  id,current_path,title,summary,intro_markdown,search_vector
) VALUES (
  gen_random_uuid(),'skills','Skills',
  'Reusable Agent Skills stored as versioned SKILL.md pages.','',
  directory_search_vector(
    'skills','Skills','Reusable Agent Skills stored as versioned SKILL.md pages.',''
  )
)
ON CONFLICT (current_path) DO NOTHING;
