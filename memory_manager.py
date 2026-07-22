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
        conn.commit()
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

    def save_workspace_file(self, filename, content, append=False):
        if not filename: return False
        clean_path = os.path.normpath(filename).lstrip('/')
        if clean_path.startswith(".."): return False
        dir_name = os.path.dirname(clean_path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)
        mode = "a" if append else "w"
        with open(clean_path, mode, encoding="utf-8") as f: f.write(content)
        return True

    def get_recent_facts_summary(self, limit=5):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT content FROM facts ORDER BY id DESC LIMIT ?", (limit,))
        results = [row[0] for row in cursor.fetchall()]
        conn.close()
        if not results:
            return "No previous facts recorded."
        return "\n".join([f"- {fact}" for fact in results])

memory_manager = MemoryManager()
