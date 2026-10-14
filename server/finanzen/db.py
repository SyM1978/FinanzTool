"""Datenbankzugriff. Jede Anfrage eines Nutzers läuft in einer Transaktion mit
SET LOCAL app.user_id – die Row-Level Security in PostgreSQL sorgt dafür,
dass dabei nur dessen eigene Zeilen sichtbar sind."""
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

_pool: Optional[ConnectionPool] = None


def _configure(conn: psycopg.Connection) -> None:
    conn.execute("SET search_path = fin, public")
    conn.commit()


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(settings.database_url, min_size=settings.pool_min, max_size=settings.pool_max,
                               kwargs={"row_factory": dict_row}, configure=_configure, open=True)
    return _pool


def close() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def tx(user_id: Optional[str] = None) -> Iterator[psycopg.Connection]:
    """Transaktion; mit user_id als dieser Nutzer (RLS), ohne nur für Auth-Funktionen und Cache."""
    with pool().connection() as conn:
        with conn.transaction():
            if user_id:
                conn.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))
            yield conn
