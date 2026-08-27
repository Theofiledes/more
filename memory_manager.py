import sqlite3
import json
import os

class MemoryManager:
    def __init__(self, db_path="memory.db"):
        self.db_path = db_path
        self.init_db()

    def init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Consolidation replaces facts with merged ones. It archives rather than deletes,
        # so a bad merge is recoverable and nothing BMO learned is ever truly lost.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS facts_archive (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                timestamp DATETIME,
                archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                batch TEXT
            )
        ''')
        conn.commit()
        conn.close()

    def all_facts(self):
        conn = sqlite3.connect(self.db_path)
        rows = conn.execute("SELECT id, content FROM facts ORDER BY id").fetchall()
        conn.close()
        return [{"id": r[0], "content": r[1]} for r in rows]

    def replace_facts(self, new_facts, batch_label=""):
        """Swap the fact set for a consolidated one, archiving what was there.

        Returns (archived_count, inserted_count). Refuses to run on an empty
        replacement — a model that returns nothing must not wipe BMO's memory."""
        new_facts = [f.strip() for f in new_facts if f and f.strip()]
        if not new_facts:
            raise ValueError("refusing to replace facts with an empty set")
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        try:
            cur.execute("BEGIN")
            cur.execute(
                "INSERT INTO facts_archive (content, timestamp, batch) "
                "SELECT content, timestamp, ? FROM facts", (batch_label,))
            archived = cur.rowcount
            cur.execute("DELETE FROM facts")
            cur.executemany("INSERT INTO facts (content) VALUES (?)",
                            [(f,) for f in new_facts])
            conn.commit()
            return archived, len(new_facts)
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def restore_last_archive(self):
        """Undo the most recent consolidation."""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        row = cur.execute("SELECT batch FROM facts_archive ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            conn.close()
            return 0
        batch = row[0]
        try:
            cur.execute("BEGIN")
            cur.execute("DELETE FROM facts")
            cur.execute("INSERT INTO facts (content, timestamp) "
                        "SELECT content, timestamp FROM facts_archive WHERE batch = ?", (batch,))
            n = cur.rowcount
            cur.execute("DELETE FROM facts_archive WHERE batch = ?", (batch,))
            conn.commit()
            return n
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def add_fact(self, content):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("INSERT INTO facts (content) VALUES (?)", (content,))
        conn.commit()
        conn.close()

    def search_facts(self, query, limit=3):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        keywords = query.split()
        if not keywords: return []
        search_query = " OR ".join(["content LIKE ?" for _ in keywords])
        params = [f"%{k}%" for k in keywords]
        cursor.execute(f"SELECT content FROM facts WHERE {search_query} ORDER BY id DESC LIMIT ?", (*params, limit))
        results = [row[0] for row in cursor.fetchall()]
        conn.close()
        return results

    def _get_path(self, filename):
        if os.path.exists(filename):
            return filename
        app_path = f"/app/{filename}"
        if os.path.exists(app_path):
            return app_path
        return filename

    def get_workspace_file(self, filename):
        if not filename: return None
        clean_path = os.path.normpath(filename).lstrip('/')
        if clean_path.startswith(".."): return None
        if os.path.exists(clean_path):
            with open(clean_path, "r", encoding="utf-8") as f: return f.read()
        return None

    def resolve_workspace_path(self, filename, workspace=None):
        """Resolve a requested path, or raise if it escapes the workspace.

        This used to `.lstrip('/')` an absolute path, which silently turned
        /home/you/notes.md into ./home/you/notes.md — the write landed inside the repo
        under a fabricated directory tree while the tool still reported success. Telling
        someone a file was saved when it is somewhere else entirely is worse than
        refusing, so out-of-workspace writes now raise instead of being relocated."""
        if not filename:
            raise ValueError("no path given")
        workspace = os.path.abspath(workspace or os.getcwd())
        candidate = os.path.expanduser(str(filename))
        if not os.path.isabs(candidate):
            candidate = os.path.join(workspace, candidate)
        resolved = os.path.abspath(os.path.normpath(candidate))
        outside = resolved != workspace and not resolved.startswith(workspace + os.sep)
        # run_command can already write anywhere, so confining write_file is not a real
        # security boundary — but defaulting to the workspace keeps a fresh install from
        # scattering files across someone's home directory. Opt in for multi-project use.
        if outside and os.getenv("BMO_ALLOW_EXTERNAL_WRITES", "").lower() not in ("1", "true", "yes"):
            raise PermissionError(
                f"'{filename}' is outside BMO's workspace ({workspace}). "
                f"Set BMO_ALLOW_EXTERNAL_WRITES=true in .env to allow writing elsewhere.")
        return resolved

    def save_workspace_file(self, filename, content, append=False, workspace=None):
        """Returns True on success. Raises PermissionError for out-of-workspace paths so
        the caller can report the real reason rather than a bare False."""
        resolved = self.resolve_workspace_path(filename, workspace)
        dir_name = os.path.dirname(resolved)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)
        mode = "a" if append else "w"
        with open(resolved, mode, encoding="utf-8") as f:
            f.write(content)
        return True

    def count_facts(self):
        conn = sqlite3.connect(self.db_path)
        n = conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        conn.close()
        return n

    def get_recent_facts_summary(self, limit=20):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT content FROM facts ORDER BY id DESC LIMIT ?", (limit,))
        results = [row[0] for row in cursor.fetchall()]
        conn.close()
        if not results:
            return "No previous facts recorded."
        return "\n".join([f"- {fact}" for fact in results])

memory_manager = MemoryManager()
