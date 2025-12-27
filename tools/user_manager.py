import sqlite3
import hashlib
import os
import sys
import argparse

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'user_data.db')

def get_db():
    return sqlite3.connect(DB_PATH)

def init_user_table():
    conn = get_db()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (email TEXT PRIMARY KEY, password_hash TEXT, salt TEXT)''')
    conn.commit()
    conn.close()

def hash_password(password, salt=None):
    if salt is None:
        salt = os.urandom(16).hex()
    # Use PBKDF2 for security
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return dk.hex(), salt

def add_user(email, password):
    init_user_table()
    conn = get_db()
    c = conn.cursor()
    
    pwd_hash, salt = hash_password(password)
    
    try:
        c.execute("INSERT OR REPLACE INTO users (email, password_hash, salt) VALUES (?, ?, ?)", 
                  (email, pwd_hash, salt))
        conn.commit()
        print(f"User {email} added/updated successfully.")
    except Exception as e:
        print(f"Error adding user: {e}")
    finally:
        conn.close()

def list_users():
    init_user_table()
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT email FROM users")
    rows = c.fetchall()
    if not rows:
        print("No users found.")
    else:
        print("Registered Users:")
        for row in rows:
            print(f"- {row[0]}")
    conn.close()

def main():
    parser = argparse.ArgumentParser(description="Manage Network Lab Users")
    subparsers = parser.add_subparsers(dest='command', help='Command to execute')
    
    # Add User
    add_parser = subparsers.add_parser('add', help='Add a new user')
    add_parser.add_argument('email', help='User email')
    add_parser.add_argument('password', help='User password')
    
    # List Users
    subparsers.add_parser('list', help='List all users')
    
    args = parser.parse_args()
    
    if args.command == 'add':
        add_user(args.email, args.password)
    elif args.command == 'list':
        list_users()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
