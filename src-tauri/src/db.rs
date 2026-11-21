//! SQLite persistence for jobs (history + queue) and settings.
//! Jobs are stored as JSON blobs keyed by id: the schema stays trivial and
//! adding fields to `Job` needs no migration (serde fills defaults).

use crate::models::{Job, Settings};
use rusqlite::{params, Connection};
use std::path::Path;

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                data TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS kv (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );",
        )?;
        Ok(Self { conn })
    }

    pub fn load_jobs(&self) -> Vec<Job> {
        let mut stmt = match self
            .conn
            .prepare("SELECT data FROM jobs ORDER BY created_at ASC")
        {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map([], |row| row.get::<_, String>(0))
            .map(|rows| {
                rows.filter_map(|r| r.ok())
                    .filter_map(|s| serde_json::from_str(&s).ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn save_job(&self, job: &Job) {
        if let Ok(data) = serde_json::to_string(job) {
            let _ = self.conn.execute(
                "INSERT INTO jobs (id, created_at, data) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                params![job.id, job.created_at, data],
            );
        }
    }

    pub fn save_jobs(&mut self, jobs: &[Job]) {
        if let Ok(tx) = self.conn.transaction() {
            for job in jobs {
                if let Ok(data) = serde_json::to_string(job) {
                    let _ = tx.execute(
                        "INSERT INTO jobs (id, created_at, data) VALUES (?1, ?2, ?3)
                         ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                        params![job.id, job.created_at, data],
                    );
                }
            }
            let _ = tx.commit();
        }
    }

    pub fn delete_jobs(&mut self, ids: &[String]) {
        if let Ok(tx) = self.conn.transaction() {
            for id in ids {
                let _ = tx.execute("DELETE FROM jobs WHERE id = ?1", params![id]);
            }
            let _ = tx.commit();
        }
    }

    pub fn load_settings(&self) -> Option<Settings> {
        self.conn
            .query_row("SELECT value FROM kv WHERE key = 'settings'", [], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn save_settings(&self, settings: &Settings) {
        if let Ok(v) = serde_json::to_string(settings) {
            let _ = self.conn.execute(
                "INSERT INTO kv (key, value) VALUES ('settings', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![v],
            );
        }
    }
}
