from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
import urllib.parse
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./helix.db")

# Automatically handle dialect prefix and special characters in PostgreSQL URLs
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Ensure URL-encoded password if unencoded special characters like '#' exist in URL
if DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgresql+psycopg2://"):
    try:
        # Check if password needs percent-encoding
        if "@" in DATABASE_URL and "://" in DATABASE_URL:
            proto, rest = DATABASE_URL.split("://", 1)
            creds, host_part = rest.split("@", 1)
            if ":" in creds:
                user, password = creds.split(":", 1)
                encoded_password = urllib.parse.quote_plus(urllib.parse.unquote_plus(password))
                DATABASE_URL = f"{proto}://{user}:{encoded_password}@{host_part}"
    except Exception:
        pass

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=10,
        max_overflow=20
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


