import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { join } from 'path'

const dataDir = join(process.cwd(), 'data')
const reelsDir = join(dataDir, 'reels')

// Ensure data directories exist
mkdirSync(dataDir, { recursive: true })
mkdirSync(reelsDir, { recursive: true })

const dbPath = join(dataDir, 'bugreel.db')

const db = new DatabaseSync(dbPath)

// Enable WAL mode for better concurrent performance
db.exec('PRAGMA journal_mode = WAL')

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
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
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
try { db.exec('ALTER TABLE api_tokens ADD COLUMN user_id TEXT') } catch {}
db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_members (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(workspace_id, user_id)
  );
`)

export { db, reelsDir }
