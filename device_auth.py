"""Device pairing auth for BMO.

Replaces "everyone shares one API token" with per-device tokens you can revoke
individually. Designed for a self-hosted app reached over a private network
(Tailscale/LAN), so it deliberately avoids anything needing a public HTTPS
callback — no OAuth redirects, no cookies. The Android build loads its UI from
`https://localhost` inside the WebView, so a redirect-based flow can't work there
anyway; everything here is a plain JSON POST with a bearer token.

Trust bootstrap: the very first pairing code is printed to the server console
(and server.log) at startup when no devices are enrolled. Only someone with shell
or log access to the host can enroll device #1. After that, any paired device can
mint invite codes for the next one.

Tokens are stored as SHA-256 hashes, so a leaked database file alone can't be used
to impersonate a device.
"""

import hashlib
import secrets
import sqlite3
import time

# Pairing codes are short enough to retype from a screen, and short-lived. They are
# single-use, and rate-limited by the redeem endpoint.
PAIRING_CODE_TTL_SECONDS = 15 * 60
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1 — avoids retyping mistakes


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def generate_code() -> str:
    """A 8-char human-typable code, formatted as XXXX-XXXX."""
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_code(code: str) -> str:
    """Accept sloppy input: lowercase, missing dash, stray spaces."""
    return "".join(ch for ch in (code or "").upper() if ch in _ALPHABET)


class DeviceAuth:
    def __init__(self, db_path="memory.db"):
        self.db_path = db_path
        self.init_db()

    def _conn(self):
        return sqlite3.connect(self.db_path)

    def init_db(self):
        conn = self._conn()
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                last_seen INTEGER,
                revoked INTEGER NOT NULL DEFAULT 0
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS pairing_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code_hash TEXT NOT NULL UNIQUE,
                label TEXT,
                expires_at INTEGER NOT NULL,
                used_at INTEGER
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token_hash)")
        conn.commit()
        conn.close()

    # --- pairing codes -----------------------------------------------------

    def create_pairing_code(self, label: str = "") -> str:
        """Mint a single-use pairing code. Returns the plaintext code — this is the
        only time it exists in plaintext, only the hash is stored."""
        self.purge_expired_codes()
        code = generate_code()
        conn = self._conn()
        conn.execute(
            "INSERT INTO pairing_codes (code_hash, label, expires_at) VALUES (?, ?, ?)",
            (_hash(normalize_code(code)), label, int(time.time()) + PAIRING_CODE_TTL_SECONDS),
        )
        conn.commit()
        conn.close()
        return code

    def purge_expired_codes(self):
        conn = self._conn()
        conn.execute("DELETE FROM pairing_codes WHERE expires_at < ? OR used_at IS NOT NULL",
                     (int(time.time()),))
        conn.commit()
        conn.close()

    def redeem_pairing_code(self, code: str, device_name: str):
        """Consume a valid code and enroll a device. Returns the new device token in
        plaintext (only chance to see it) or None if the code is bad/expired/used."""
        normalized = normalize_code(code)
        if not normalized:
            return None
        now = int(time.time())
        conn = self._conn()
        c = conn.cursor()
        row = c.execute(
            "SELECT id FROM pairing_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?",
            (_hash(normalized), now),
        ).fetchone()
        if not row:
            conn.close()
            return None
        # Burn the code first — a redeem that races itself must not enroll twice.
        c.execute("UPDATE pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL", (now, row[0]))
        if c.rowcount != 1:
            conn.rollback()
            conn.close()
            return None
        token = secrets.token_urlsafe(32)
        c.execute(
            "INSERT INTO devices (name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?)",
            ((device_name or "Unnamed device")[:64], _hash(token), now, now),
        )
        conn.commit()
        conn.close()
        return token

    # --- device tokens -----------------------------------------------------

    def verify_token(self, token: str):
        """Return the device row dict if this token belongs to a live device."""
        if not token:
            return None
        conn = self._conn()
        c = conn.cursor()
        row = c.execute(
            "SELECT id, name FROM devices WHERE token_hash = ? AND revoked = 0",
            (_hash(token),),
        ).fetchone()
        if row:
            c.execute("UPDATE devices SET last_seen = ? WHERE id = ?", (int(time.time()), row[0]))
            conn.commit()
        conn.close()
        return {"id": row[0], "name": row[1]} if row else None

    def list_devices(self):
        conn = self._conn()
        rows = conn.execute(
            "SELECT id, name, created_at, last_seen, revoked FROM devices ORDER BY created_at"
        ).fetchall()
        conn.close()
        return [
            {"id": r[0], "name": r[1], "created_at": r[2], "last_seen": r[3], "revoked": bool(r[4])}
            for r in rows
        ]

    def revoke_device(self, device_id: int) -> bool:
        conn = self._conn()
        c = conn.cursor()
        c.execute("UPDATE devices SET revoked = 1 WHERE id = ?", (device_id,))
        changed = c.rowcount
        conn.commit()
        conn.close()
        return changed > 0

    def device_count(self, include_revoked=False) -> int:
        conn = self._conn()
        q = "SELECT COUNT(*) FROM devices" + ("" if include_revoked else " WHERE revoked = 0")
        n = conn.execute(q).fetchone()[0]
        conn.close()
        return n


device_auth = DeviceAuth()
