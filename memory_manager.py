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

    def get_workspace_file(self, filename):
        allowed = ["SOUL.md", "AGENTS.md", "MEMORY.md"]
        if filename not in allowed: return None
        # FIX: Point to the mapped /app directory inside bmo_backend
        path = f"/app/{filename}"
        if os.path.exists(path):
            with open(path, "r") as f: return f.read()
        return f"# {filename}\nBMO workspace file initialized."

    def save_workspace_file(self, filename, content, append=False):
        allowed = ["SOUL.md", "AGENTS.md", "MEMORY.md"]
        if filename not in allowed: return False
        path = f"/app/{filename}"
        mode = "a" if append else "w"
        with open(path, mode) as f: f.write(content)
        return True

memory_manager = MemoryManager()
