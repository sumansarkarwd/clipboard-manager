use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipEntry {
    pub id: i64,
    pub kind: String,
    pub content: Option<String>,
    pub image_path: Option<String>,
    pub source_app: Option<String>,
    pub hash: String,
    pub pinned: bool,
    pub created_at: i64,
}

pub fn open(data_dir: &PathBuf) -> Result<Connection> {
    std::fs::create_dir_all(data_dir).ok();
    let db_path = data_dir.join("history.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clips (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            kind       TEXT    NOT NULL,
            content    TEXT,
            image_path TEXT,
            source_app TEXT,
            hash       TEXT    NOT NULL UNIQUE,
            pinned     INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(
            content,
            content='clips',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS clips_ai AFTER INSERT ON clips BEGIN
            INSERT INTO clips_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS clips_ad AFTER DELETE ON clips BEGIN
            INSERT INTO clips_fts(clips_fts, rowid, content) VALUES('delete', old.id, old.content);
        END;",
    )?;
    Ok(conn)
}

pub fn upsert(conn: &Connection, entry: &ClipEntry) -> Result<()> {
    conn.execute(
        "INSERT INTO clips (kind, content, image_path, source_app, hash, pinned, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
         ON CONFLICT(hash) DO UPDATE SET created_at = excluded.created_at",
        params![
            entry.kind, entry.content, entry.image_path,
            entry.source_app, entry.hash, entry.created_at
        ],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, limit: i64, offset: i64) -> Result<Vec<ClipEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, content, image_path, source_app, hash, pinned, created_at
         FROM clips ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt.query_map(params![limit, offset], row_to_entry)?;
    rows.collect()
}

pub fn search(conn: &Connection, query: &str, limit: i64) -> Result<Vec<ClipEntry>> {
    // Strip FTS5 special chars, then try ranked FTS query; fall back to LIKE.
    let clean: String = query
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '-')
        .collect();
    let fts_query = format!("{}*", clean.trim());

    let fts_result: Result<Vec<ClipEntry>> = (|| {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.kind, c.content, c.image_path, c.source_app, c.hash, c.pinned, c.created_at
             FROM clips_fts
             JOIN clips c ON c.id = clips_fts.rowid
             WHERE clips_fts MATCH ?1
             ORDER BY bm25(clips_fts)
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![fts_query, limit], row_to_entry)?;
        rows.collect()
    })();

    match fts_result {
        Ok(r) if !r.is_empty() => Ok(r),
        _ => {
            // LIKE fallback — handles special chars and empty FTS results
            let like = format!("%{}%", query.trim());
            let mut stmt = conn.prepare(
                "SELECT id, kind, content, image_path, source_app, hash, pinned, created_at
                 FROM clips WHERE content LIKE ?1 ESCAPE '\\'
                 ORDER BY created_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![like, limit], row_to_entry)?;
            rows.collect()
        }
    }
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM clips WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM clips", [])?;
    conn.execute_batch("INSERT INTO clips_fts(clips_fts) VALUES('rebuild')")?;
    Ok(())
}

pub fn prune(conn: &Connection, max_items: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM clips WHERE pinned = 0 AND id NOT IN (
            SELECT id FROM clips ORDER BY created_at DESC LIMIT ?1
         )",
        params![max_items],
    )?;
    Ok(())
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<ClipEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, content, image_path, source_app, hash, pinned, created_at
         FROM clips WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], row_to_entry)?;
    Ok(rows.next().transpose()?)
}

fn row_to_entry(row: &rusqlite::Row) -> Result<ClipEntry> {
    Ok(ClipEntry {
        id: row.get(0)?,
        kind: row.get(1)?,
        content: row.get(2)?,
        image_path: row.get(3)?,
        source_app: row.get(4)?,
        hash: row.get(5)?,
        pinned: row.get::<_, i32>(6)? != 0,
        created_at: row.get(7)?,
    })
}
