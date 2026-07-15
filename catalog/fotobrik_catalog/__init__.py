"""Fotobrik's versioned brick-parts catalog foundation."""

from .db import SCHEMA_VERSION, connect, initialize_database

__all__ = ["SCHEMA_VERSION", "connect", "initialize_database"]
__version__ = "0.1.0"
