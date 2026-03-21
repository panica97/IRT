"""Sync repository for instruments (pipeline side).

All functions receive a SQLAlchemy sync ``Session`` and operate
synchronously using psycopg2.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Instrument


def get_all_instruments(session: Session) -> list[Instrument]:
    """Return all instruments ordered by symbol."""
    stmt = select(Instrument).order_by(Instrument.symbol)
    return list(session.execute(stmt).scalars().all())


def get_by_symbol(session: Session, symbol: str) -> Instrument | None:
    """Return an instrument by its symbol (exact match), or ``None``."""
    stmt = select(Instrument).where(Instrument.symbol == symbol)
    return session.execute(stmt).scalar_one_or_none()


def upsert_instrument(
    session: Session,
    symbol: str,
    sec_type: str,
    exchange: str,
    currency: str,
    multiplier: float,
    min_tick: float,
    description: str | None = None,
) -> Instrument:
    """Insert or update an instrument.

    Deduplication is by ``symbol`` (unique constraint).
    Returns the inserted/updated ``Instrument`` object.
    """
    existing = get_by_symbol(session, symbol)
    if existing is not None:
        existing.sec_type = sec_type
        existing.exchange = exchange
        existing.currency = currency
        existing.multiplier = multiplier
        existing.min_tick = min_tick
        existing.description = description
        session.flush()
        return existing

    instrument = Instrument(
        symbol=symbol,
        sec_type=sec_type,
        exchange=exchange,
        currency=currency,
        multiplier=multiplier,
        min_tick=min_tick,
        description=description,
    )
    session.add(instrument)
    session.flush()
    return instrument


def delete_instrument(session: Session, symbol: str) -> bool:
    """Delete an instrument by symbol.

    Returns ``True`` if the instrument was found and deleted, ``False`` otherwise.
    """
    existing = get_by_symbol(session, symbol)
    if existing is None:
        return False
    session.delete(existing)
    session.flush()
    return True
