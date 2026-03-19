import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'

const dataDir = join(process.cwd(), 'data')
const reelsDir = join(dataDir, 'reels')

// Ensure data directories exist
mkdirSync(dataDir, { recursive: true })
mkdirSync(reelsDir, { recursive: true })

const dbPath = join(dataDir, 'bugreel.db')

const db = new Database(dbPath)

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL')

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    size INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    user_id TEXT
  );

  CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS reel_comments (
    id TEXT PRIMARY KEY,
    reel_id TEXT NOT NULL,
    parent_id TEXT,
    user_id TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`)

try { db.exec('ALTER TABLE reels ADD COLUMN app_id TEXT') } catch {}
try { db.exec('ALTER TABLE reels ADD COLUMN uploaded_by_user_id TEXT') } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE reel_comments ADD COLUMN element_info TEXT') } catch {}
try { db.exec('ALTER TABLE reels ADD COLUMN reporter_email TEXT') } catch {}
try { db.exec('ALTER TABLE reels ADD COLUMN reporter_name TEXT') } catch {}
try { db.exec('ALTER TABLE apps ADD COLUMN ticket_provider TEXT DEFAULT NULL') } catch {}
try { db.exec('ALTER TABLE apps ADD COLUMN ticket_config TEXT DEFAULT NULL') } catch {}
try { db.exec('ALTER TABLE reels ADD COLUMN ticket_id TEXT DEFAULT NULL') } catch {}
try { db.exec('ALTER TABLE reels ADD COLUMN ticket_url TEXT DEFAULT NULL') } catch {}

// Migrate api_tokens: remove workspace_id, make app_id NOT NULL (tokens are app-scoped now)
{
  const col = db.prepare(`SELECT name FROM pragma_table_info('api_tokens') WHERE name = 'workspace_id'`).get()
  if (col) {
    db.exec(`
      CREATE TABLE api_tokens_new (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL,
        user_id TEXT
      );
      INSERT INTO api_tokens_new (id, app_id, name, token, created_at, user_id)
        SELECT id, app_id, name, token, created_at, user_id FROM api_tokens WHERE app_id IS NOT NULL;
      DROP TABLE api_tokens;
      ALTER TABLE api_tokens_new RENAME TO api_tokens;
    `)
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS email_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_members (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(workspace_id, user_id)
  );
`)

// Indexes for frequent query patterns
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_reels_workspace_id ON reels(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_reels_app_id ON reels(app_id);
  CREATE INDEX IF NOT EXISTS idx_reel_comments_reel_id ON reel_comments(reel_id);
  CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_api_tokens_app_id ON api_tokens(app_id);
`)

export { db, reelsDir }
