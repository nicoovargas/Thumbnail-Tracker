ALTER TABLE users ADD COLUMN avatar_version TEXT;
CREATE TABLE profile_photos (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 mime TEXT NOT NULL, data BLOB NOT NULL CHECK(length(data)<=250000)
);
CREATE INDEX IF NOT EXISTS miniaturas_owner_order ON miniaturas(user_id,fecha DESC,created_at DESC,id);
