import sqlite3
import json
import os
import re

# Words that carry no claim, so two facts sharing only these aren't saying the same thing.
_STOPWORDS = frozenset("""
the and for with that this from has have had was were are been being its it's you your
what when where which who whom will would can could should may might must shall about
into over under than then they them their there here also just only very more most
some any all but our out per via while does did doing done new now still remains
""".split())

# Negation is the one thing that flips a fact's meaning while leaving every other word
# intact. "The server is running" vs "The server is not running" differ by a single token
# out of eight — no similarity threshold can separate them, because by every word-overlap
# measure they ARE nearly identical. So negation is checked as a gate, not scored: if one
# fact negates and the other doesn't, they are never duplicates regardless of overlap.
# Without this, a correction is silently discarded in favor of the stale claim it was
# meant to replace, and most of what a companion learns is state that flips over time.
_NEGATIONS = frozenset("""
no not never none nothing without cannot cant dont doesnt didnt isnt arent wasnt werent
wont couldnt shouldnt wouldnt hasnt havent hadnt nor neither
""".split())
# Only grammatical negations belong above. Negative-valence words like "failed" or
# "unable" were tried here and removed: they describe an outcome rather than reverse a
# claim, so they split genuine restatements of one event apart instead of separating
# opposites. When in doubt leave a word out — a missed dedup costs one redundant fact,
# a wrongly-split pair costs nothing, but a wrongly-merged pair loses a correction.

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

    def add_fact(self, content, dedupe=True):
        """Store a fact, skipping near-duplicates. Returns True if it was stored.

        Dream synthesis re-summarizes the same conversation history on every cycle, so
        without this it writes a fresh restatement of the same thing every time it runs.
        That is not theoretical: it filled 16 of 28 stored facts with paraphrases of one
        sentence, crowding real memories out of the context budget entirely. Deduping on
        write is the only place that helps — consolidation runs too late and merging
        sixteen copies of one claim just launders it into a confident single fact.
        """
        if dedupe and self.find_similar_fact(content) is not None:
            return False
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("INSERT INTO facts (content) VALUES (?)", (content,))
        conn.commit()
        conn.close()
        return True

    def find_similar_fact(self, content, threshold=0.60):
        """Return an existing fact that says substantially the same thing, or None.

        Compares word sets rather than characters: models rephrase ("is clean" vs
        "remains clean") far more than they change what they actually assert, so a
        character-level ratio misses duplicates a reader would call identical.

        0.60 was measured, not guessed. Replaying this codebase's own 28 accumulated
        facts, restatements of one claim scored 0.5-0.86 against each other while
        genuinely unrelated facts scored 0.08-0.15 — a wide gap, so the exact cutoff
        inside it doesn't much matter. The one borderline case at 0.64 was itself a real
        duplicate. That replay collapses 28 facts to 16; it would reach 13 without the
        negation gate, and those 3 are the price of never merging a claim with its
        opposite. Raise this if legitimate facts start getting rejected.
        """
        words = self._significant_words(content)
        if len(words) < 4:
            return None   # too short to judge; let it through rather than guess
        negated = self._is_negated(content)
        conn = sqlite3.connect(self.db_path)
        try:
            rows = conn.execute("SELECT content FROM facts").fetchall()
        finally:
            conn.close()
        for (existing,) in rows:
            if self._is_negated(existing) != negated:
                continue   # see _NEGATIONS: opposite claims are never duplicates
            other = self._significant_words(existing)
            if not other:
                continue
            overlap = len(words & other) / max(len(words), len(other))
            if overlap >= threshold:
                return existing
        return None

    @staticmethod
    def _significant_words(text):
        # Strip the "Dream Milestone:" style prefix and markdown/punctuation so two
        # phrasings of one claim reduce to the same word set.
        body = re.sub(r'^[^:]{0,24}:\s*', '', (text or '').strip())
        return {w for w in re.findall(r'[a-z0-9]{3,}', body.lower())
                if w not in _STOPWORDS}

    @staticmethod
    def _is_negated(text):
        """Whether the fact asserts a negative. Apostrophes are dropped first so
        "isn't" and "isnt" both match, and "n't" doesn't survive as its own token."""
        flat = re.sub(r"['’]", '', (text or '').lower())
        return any(w in _NEGATIONS for w in re.findall(r'[a-z]+', flat))

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

    def get_workspace_file(self, filename, workspace=None):
        """Read a file from inside the workspace, or None if it isn't there.

        Anchored to the same base resolve_workspace_path() defaults to (cwd), so
        SOUL.md/AGENTS.md keep resolving exactly where they always did. The boundary
        check is realpath-based rather than the old `normpath(...).startswith("..")`
        string test: that caught ../../etc/passwd, but followed any symlink planted
        inside the workspace straight back out of it. Reading is not a real privilege
        boundary here — whoever reaches this already has run_command — so this is
        consistency with the write path, not a security control.
        """
        if not filename: return None
        base = os.path.realpath(workspace or os.getcwd())
        candidate = os.path.expanduser(str(filename))
        if not os.path.isabs(candidate):
            candidate = os.path.join(base, candidate)
        resolved = os.path.realpath(candidate)
        if resolved != base and not resolved.startswith(base + os.sep):
            return None
        if os.path.isfile(resolved):
            with open(resolved, "r", encoding="utf-8") as f: return f.read()
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
