-- Add status column to files table
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
ADD COLUMN IF NOT EXISTS upload_progress INTEGER DEFAULT 0; 