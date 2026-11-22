PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, nombre TEXT NOT NULL,
 rol TEXT NOT NULL CHECK(rol IN ('disenador','encargado')), is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN(0,1)),
 password_hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL DEFAULT 100000,
 failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS setup (
 id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN(0,1))
);
CREATE TABLE IF NOT EXISTS images (
 id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL CHECK(length(data)<=700000)
);
CREATE TABLE IF NOT EXISTS miniaturas (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 user_id TEXT NOT NULL REFERENCES users(id), cliente TEXT NOT NULL, titulo TEXT NOT NULL, fecha TEXT NOT NULL,
 minutos INTEGER CHECK(minutos>=0), revisiones INTEGER CHECK(revisiones>=0), link_video TEXT, notas TEXT,
 imagen_path TEXT NOT NULL REFERENCES images(id)
);
CREATE INDEX IF NOT EXISTS miniaturas_order ON miniaturas(fecha DESC,created_at DESC,id);
CREATE TABLE IF NOT EXISTS pagos (
 miniatura_id TEXT PRIMARY KEY REFERENCES miniaturas(id) ON DELETE CASCADE, monto REAL CHECK(monto>=0),
 pagado INTEGER NOT NULL DEFAULT 0 CHECK(pagado IN(0,1)), fecha_pago TEXT, nota TEXT, updated_at TEXT NOT NULL
);
