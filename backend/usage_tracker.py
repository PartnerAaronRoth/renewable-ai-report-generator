from typing import Dict, Optional
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import yaml

# Load config
with open("config.yml", "r") as f:
    config = yaml.safe_load(f)

USAGE_CAP_ENABLED = config["usage_cap"]["enabled"]
USAGE_CAP_PERIOD = config["usage_cap"]["period"]
USAGE_CAP_LIMIT = config["usage_cap"]["limit_usd"]
STORAGE_TYPE = config["usage_storage"]["type"]

# Initialize storage backend
if STORAGE_TYPE == "mysql":
    import pymysql
    from pymysql import pooling
    
    # Load MySQL credentials from environment variables
    MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
    MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
    MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "renewable_ai_usage")
    MYSQL_USER = os.getenv("MYSQL_USER", "root")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
    
    # Create connection pool
    connection_pool = pooling.Pool(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        database=MYSQL_DATABASE,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        max_connections=5,
        autocommit=True
    )
    
    # Create table if not exists
    def init_mysql_table():
        conn = connection_pool.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS usage_tracking (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_email VARCHAR(255) NOT NULL,
                period_key VARCHAR(50) NOT NULL,
                cost_usd DECIMAL(10, 6) NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_period (user_email, period_key),
                INDEX idx_user_period (user_email, period_key)
            )
        """)
        conn.commit()
        cursor.close()
        conn.close()
    
    init_mysql_table()

elif STORAGE_TYPE == "file":
    FILE_PATH = Path(config["usage_storage"]["file"]["path"])
    # File will be created on first use, not at import time


def get_period_key() -> str:
    """Get current period key based on config"""
    now = datetime.utcnow()
    
    if USAGE_CAP_PERIOD == "daily":
        return now.strftime("%Y-%m-%d")
    elif USAGE_CAP_PERIOD == "weekly":
        return now.strftime("%Y-W%U")
    elif USAGE_CAP_PERIOD == "monthly":
        return now.strftime("%Y-%m")
    else:
        raise ValueError(f"Invalid period: {USAGE_CAP_PERIOD}")


def get_user_usage(user_email: str) -> float:
    """Get current usage for user in current period"""
    period_key = get_period_key()
    
    if STORAGE_TYPE == "mysql":
        conn = connection_pool.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT cost_usd FROM usage_tracking WHERE user_email = %s AND period_key = %s",
            (user_email, period_key)
        )
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        return float(result[0]) if result else 0.0
    
    elif STORAGE_TYPE == "file":
        key = f"usage:{user_email}:{period_key}"
        # Create file if it doesn't exist
        if not FILE_PATH.exists():
            FILE_PATH.write_text(json.dumps({}))
        data = json.loads(FILE_PATH.read_text())
        return data.get(key, 0.0)


def add_user_usage(user_email: str, cost_usd: float):
    """Add usage cost for user in current period"""
    period_key = get_period_key()
    
    if STORAGE_TYPE == "mysql":
        conn = connection_pool.get_connection()
        cursor = conn.cursor()
        # Use INSERT ... ON DUPLICATE KEY UPDATE to handle upsert
        cursor.execute("""
            INSERT INTO usage_tracking (user_email, period_key, cost_usd)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE cost_usd = cost_usd + VALUES(cost_usd)
        """, (user_email, period_key, cost_usd))
        conn.commit()
        cursor.close()
        conn.close()
    
    elif STORAGE_TYPE == "file":
        key = f"usage:{user_email}:{period_key}"
        # Create file if it doesn't exist
        if not FILE_PATH.exists():
            FILE_PATH.write_text(json.dumps({}))
        data = json.loads(FILE_PATH.read_text())
        current = data.get(key, 0.0)
        data[key] = current + cost_usd
        FILE_PATH.write_text(json.dumps(data, indent=2))


def check_usage_limit(user_email: str, estimated_cost: float = 0.0) -> tuple[bool, float, float]:
    """
    Check if user is under usage limit
    
    Returns:
        (is_allowed, current_usage, remaining_budget)
    """
    if not USAGE_CAP_ENABLED:
        return (True, 0.0, float('inf'))
    
    current_usage = get_user_usage(user_email)
    remaining = USAGE_CAP_LIMIT - current_usage
    
    is_allowed = (current_usage + estimated_cost) <= USAGE_CAP_LIMIT
    
    return (is_allowed, current_usage, remaining)


def get_usage_stats(user_email: str) -> Dict:
    """Get usage statistics for user"""
    current_usage = get_user_usage(user_email)
    
    return {
        "period": USAGE_CAP_PERIOD,
        "period_key": get_period_key(),
        "current_usage_usd": round(current_usage, 4),
        "limit_usd": USAGE_CAP_LIMIT if USAGE_CAP_ENABLED else None,
        "remaining_usd": round(USAGE_CAP_LIMIT - current_usage, 4) if USAGE_CAP_ENABLED else None,
        "unlimited": not USAGE_CAP_ENABLED,
        "storage_type": STORAGE_TYPE
    }
