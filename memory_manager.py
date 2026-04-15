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
        # Simple text search table for now (Loop 6)
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
        # Simplistic keyword search for this pass
        # In a full impl, we'd use sqlite-vec or an embedding model
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Very basic "RAG" - find rows containing keywords from the query
        keywords = query.split()
        if not keywords:
            return []
            
        search_query = " OR ".join(["content LIKE ?" for _ in keywords])
        params = [f"%{k}%" for k in keywords]
        
        cursor.execute(f"SELECT content FROM facts WHERE {search_query} ORDER BY id DESC LIMIT ?", (*params, limit))
        results = [row[0] for row in cursor.fetchall()]
        conn.close()
        return results

    def get_workspace_file(self, filename):
        # Restrict to specific files for security
        allowed = ["SOUL.md", "AGENTS.md", "MEMORY.md"]
        if filename not in allowed:
            return None
            
        path = f"/home/node/.openclaw/workspace/{filename}"
        if os.path.exists(path):
            with open(path, "r") as f:
                return f.read()
        return ""

    def save_workspace_file(self, filename, content):
        allowed = ["SOUL.md", "AGENTS.md", "MEMORY.md"]
        if filename not in allowed:
            return False
            
        path = f"/home/node/.openclaw/workspace/{filename}"
        # Ensure dir exists (mapped via volume)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        return True

memory_manager = MemoryManager()
