-- Migration: Cascade deletes for shared notes and shared solutions

-- Clean up any orphaned shared_notes before applying the constraint
DELETE FROM shared_notes 
WHERE source_note_id IS NOT NULL 
  AND source_note_id NOT IN (SELECT id FROM notes);

-- Clean up any orphaned shared_solutions before applying the constraint
DELETE FROM shared_solutions 
WHERE source_solution_id IS NOT NULL 
  AND source_solution_id NOT IN (SELECT id FROM solutions);

-- Add ON DELETE CASCADE to shared_notes source_note_id
ALTER TABLE shared_notes 
  DROP CONSTRAINT IF EXISTS shared_notes_source_note_id_fkey;

ALTER TABLE shared_notes 
  ADD CONSTRAINT shared_notes_source_note_id_fkey 
  FOREIGN KEY (source_note_id) 
  REFERENCES notes(id) 
  ON DELETE CASCADE;

-- Add ON DELETE CASCADE to shared_solutions source_solution_id
ALTER TABLE shared_solutions 
  DROP CONSTRAINT IF EXISTS shared_solutions_source_solution_id_fkey;

ALTER TABLE shared_solutions 
  ADD CONSTRAINT shared_solutions_source_solution_id_fkey 
  FOREIGN KEY (source_solution_id) 
  REFERENCES solutions(id) 
  ON DELETE CASCADE;
