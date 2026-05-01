from flask import Flask, request, jsonify

from flask_cors import CORS

from flask_socketio import SocketIO, join_room

import psycopg2

from flask_socketio import emit

from cards_hash import generate_final_key, joker

from cards_cipher import encrypt, decrypt

import re

import os

import sys

from flask import send_from_directory
from dotenv import load_dotenv
load_dotenv()

import webbrowser
import threading

# Required for PyInstaller EXE — forces threading driver to be bundled
import engineio.async_drivers.threading  # noqa

def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except AttributeError:
        base_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    return os.path.join(base_path, relative_path)


app = Flask(__name__)

app.config['SECRET_KEY'] = 'cards_secret_key_2026'

CORS(app, supports_credentials=True, origins="*")

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')



def get_db():
    conn_str = os.environ.get("DATABASE_URL")
    return psycopg2.connect(conn_str)



def init_db():

    conn = get_db()

    cur = conn.cursor()

    cur.execute("""

        CREATE TABLE IF NOT EXISTS users (

            id SERIAL PRIMARY KEY,

            username VARCHAR(50) UNIQUE NOT NULL,

            password_hash VARCHAR(256) NOT NULL,

            joker VARCHAR(256) NOT NULL,

            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

        );

       

        CREATE TABLE IF NOT EXISTS friends (

            id SERIAL PRIMARY KEY,

            user1 VARCHAR(50) NOT NULL,

            user2 VARCHAR(50) NOT NULL,

            status VARCHAR(20) NOT NULL DEFAULT 'pending',

            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(user1, user2)

        );

        CREATE TABLE IF NOT EXISTS messages (

            id SERIAL PRIMARY KEY,

            sender VARCHAR(50) NOT NULL,

            receiver VARCHAR(50) NOT NULL,

            message TEXT NOT NULL,

            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

        );

        CREATE TABLE IF NOT EXISTS unread (

            reader  VARCHAR(50) NOT NULL,

            sender  VARCHAR(50) NOT NULL,

            count   INTEGER NOT NULL DEFAULT 0,

            PRIMARY KEY (reader, sender)

        );

    """)

   

    cur.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;")

   

    conn.commit()

    cur.close()

    conn.close()

    print("[DB] Tables verified and updated.")



init_db()



def norm(user):

    return re.sub(r'[^a-zA-Z0-9]', '', str(user).strip().lower())



# ===================== AUTH =====================



@app.route('/signup', methods=['POST'])

def signup():

    data = request.json

    raw = data.get('username', '').strip()

    pwd = data.get('password', '')

    if not raw or not pwd:

        return jsonify({"status": "error", "message": "Username and password required"}), 400

    if len(pwd) < 4:

        return jsonify({"status": "error", "message": "Password min 4 chars"}), 400

    username = norm(raw)

    if not username:

        return jsonify({"status": "error", "message": "Invalid username"}), 400

   

    conn = get_db(); cur = conn.cursor()

    cur.execute("SELECT username FROM users WHERE LOWER(username)=LOWER(%s)", (username,))

    if cur.fetchone():

        cur.close(); conn.close()

        return jsonify({"status": "error", "message": "Username exists"}), 400

   

    j = joker()

    h = generate_final_key(pwd, j)

    cur.execute("INSERT INTO users (username, password_hash, joker) VALUES (%s,%s,%s)", (username, h, j))

    conn.commit(); cur.close(); conn.close()

    print(f"[SIGNUP] {username}")

    return jsonify({"status": "success", "message": "Account created"})



@app.route('/login', methods=['POST'])

def login():

    data = request.json

    username = norm(data.get('username', ''))

    password = data.get('password', '')

    conn = get_db(); cur = conn.cursor()

    cur.execute("SELECT password_hash, joker FROM users WHERE LOWER(username)=LOWER(%s)", (username,))

    u = cur.fetchone()

    cur.close(); conn.close()

    if not u:

        return jsonify({"status": "error", "message": "Invalid credentials"}), 401

    h, j = u

    if generate_final_key(password, j) == h:

        print(f"[LOGIN] {username}")

        return jsonify({"status": "success", "username": username})

    return jsonify({"status": "error", "message": "Invalid credentials"}), 401



# ===================== FRIENDS =====================



@app.route('/search_users', methods=['POST'])

def search_users():

    data = request.json

    me = norm(data.get('user', ''))

    q  = norm(data.get('query', ''))

    if not q: return jsonify([])

    conn = get_db(); cur = conn.cursor()

    cur.execute("""

        SELECT username FROM users

        WHERE LOWER(username) LIKE LOWER(%s)

          AND LOWER(username) != LOWER(%s)

          AND username NOT IN (

              SELECT CASE WHEN user1=%s THEN user2 ELSE user1 END

              FROM friends WHERE (user1=%s OR user2=%s)

          )

        ORDER BY username LIMIT 20

    """, (f'%{q}%', me, me, me, me))

    r = [row[0] for row in cur.fetchall()]

    cur.close(); conn.close()

    return jsonify(r)



@app.route('/add_friend', methods=['POST'])

def add_friend():

    data = request.json

    u1 = norm(data.get('user1', ''))

    u2 = norm(data.get('user2', ''))

    if u1 == u2:

        return jsonify({"status": "error", "message": "Cannot add yourself"}), 400

    conn = get_db(); cur = conn.cursor()

    cur.execute("SELECT username FROM users WHERE LOWER(username)=LOWER(%s)", (u2,))

    if not cur.fetchone():

        cur.close(); conn.close()

        return jsonify({"status": "error", "message": "User not found"}), 404

    cur.execute("""

        SELECT user1, user2, status FROM friends

        WHERE (LOWER(user1)=LOWER(%s) AND LOWER(user2)=LOWER(%s))

           OR (LOWER(user1)=LOWER(%s) AND LOWER(user2)=LOWER(%s))

    """, (u1, u2, u2, u1))

    ex = cur.fetchone()

    if ex:

        e1, e2, st = ex

        cur.close(); conn.close()

        if st == 'accepted':

            return jsonify({"status": "error", "message": "Already friends"}), 400

        if st == 'pending' and e1.lower() == u2.lower() and e2.lower() == u1.lower():

            return jsonify({"status": "exists", "message": "They sent you a request!"}), 200

        return jsonify({"status": "error", "message": "Request exists"}), 400

   

    cur.execute("INSERT INTO friends (user1, user2, status) VALUES (%s,%s,'pending')", (u1, u2))

    conn.commit(); cur.close(); conn.close()

    socketio.emit('friend_request', {'from': u1, 'to': u2}, room=f"user_{u2}")

    return jsonify({"status": "success", "message": "Request sent"})



@app.route('/get_requests', methods=['POST'])

def get_requests():

    user = norm(request.json.get('user', ''))

    conn = get_db(); cur = conn.cursor()

    cur.execute("SELECT user1 FROM friends WHERE LOWER(user2)=LOWER(%s) AND status='pending'", (user,))

    r = [row[0] for row in cur.fetchall()]

    cur.close(); conn.close()

    return jsonify(r)



@app.route('/get_sent_requests', methods=['POST'])

def get_sent_requests():

    user = norm(request.json.get('user', ''))

    conn = get_db(); cur = conn.cursor()

    cur.execute("SELECT user2 FROM friends WHERE LOWER(user1)=LOWER(%s) AND status='pending'", (user,))

    r = [row[0] for row in cur.fetchall()]

    cur.close(); conn.close()

    return jsonify(r)



@app.route('/get_friends', methods=['POST'])

def get_friends():

    user = norm(request.json.get('user', ''))

    conn = get_db(); cur = conn.cursor()

    cur.execute("""

        SELECT CASE WHEN LOWER(user1)=LOWER(%s) THEN user2 ELSE user1 END

        FROM friends

        WHERE (LOWER(user1)=LOWER(%s) OR LOWER(user2)=LOWER(%s)) AND status='accepted'

    """, (user, user, user))

    r = [row[0] for row in cur.fetchall()]

    cur.close(); conn.close()

    return jsonify(r)



@app.route('/accept_friend', methods=['POST'])

def accept_friend():

    data   = request.json

    me     = norm(data.get('user', ''))

    sender = norm(data.get('sender', ''))

    conn = get_db(); cur = conn.cursor()

    cur.execute(

        "UPDATE friends SET status='accepted' WHERE LOWER(user1)=LOWER(%s) AND LOWER(user2)=LOWER(%s) AND status='pending'",

        (sender, me)

    )

    if cur.rowcount == 0:

        cur.close(); conn.close()

        return jsonify({"status": "error", "message": "No request found"}), 400

    conn.commit(); cur.close(); conn.close()

    socketio.emit('friend_accepted', {'user1': sender, 'user2': me}, room=f"user_{sender}")

    socketio.emit('friend_accepted', {'user1': sender, 'user2': me}, room=f"user_{me}")

    return jsonify({"status": "success", "message": "Accepted"})



@app.route('/remove_friend', methods=['POST'])

def remove_friend():

    data = request.json

    u1 = norm(data.get('user1', ''))

    u2 = norm(data.get('user2', ''))

    conn = get_db(); cur = conn.cursor()

    cur.execute(

        "DELETE FROM friends WHERE (LOWER(user1)=LOWER(%s) AND LOWER(user2)=LOWER(%s)) OR (LOWER(user1)=LOWER(%s) AND LOWER(user2)=LOWER(%s))",

        (u1, u2, u2, u1)

    )

    conn.commit(); cur.close(); conn.close()

    return jsonify({"status": "success"})



# ===================== MESSAGES =====================



@socketio.on('send_message')

def handle_send_message(data):

    sender   = norm(data.get('sender', ''))

    receiver = norm(data.get('receiver', ''))

    message  = data.get('message', '')

   

    if not sender or not receiver or not message: return



    pair = sorted([sender, receiver])

    key = f"cards_{pair[0]}_{pair[1]}"

   

    encrypted = encrypt(message, key)



    conn = get_db(); cur = conn.cursor()

    cur.execute(

        "INSERT INTO messages (sender, receiver, message) VALUES (%s,%s,%s)",

        (sender, receiver, encrypted)

    )

    conn.commit(); cur.close(); conn.close()



    socketio.emit('receive_message', {

        'sender': sender,

        'receiver': receiver,

        'message': message

    }, room='__'.join(pair))



@app.route('/messages/<u1>/<u2>', methods=['GET'])
def get_messages(u1, u2):
    try:
        u1n = norm(u1)
        u2n = norm(u2)

        pair = sorted([u1n, u2n])
        key = f"cards_{pair[0]}_{pair[1]}"
        legacy_key = f"cards_{u1n}_{u2n}"

        conn = get_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT sender, receiver, message, sent_at FROM messages
            WHERE (LOWER(sender)=LOWER(%s) AND LOWER(receiver)=LOWER(%s))
               OR (LOWER(sender)=LOWER(%s) AND LOWER(receiver)=LOWER(%s))
            ORDER BY sent_at ASC
        """, (u1n, u2n, u2n, u1n))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        msgs = []

        for s, r, m, t in rows:
            decrypted = None

            try:
                decrypted = decrypt(m, key)
                if not decrypted or not decrypted.strip():
                    raise Exception("Invalid decrypt")
            except:
                try:
                    decrypted = decrypt(m, legacy_key)
                except:
                    decrypted = "[Decryption Error]"

            time_iso = t.isoformat() if hasattr(t, 'isoformat') else str(t)

            msgs.append({
                'sender': s,
                'receiver': r,
                'message': decrypted,
                'sent_at': time_iso
            })

        return jsonify(msgs)

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500



@app.route('/unread_counts', methods=['POST'])

def unread_counts():

    user = norm(request.json.get('user', ''))

    conn = get_db(); cur = conn.cursor()

    cur.execute("SELECT sender, count FROM unread WHERE LOWER(reader)=LOWER(%s) AND count > 0", (user,))

    counts = {row[0]: row[1] for row in cur.fetchall()}

    cur.close(); conn.close()

    return jsonify(counts)



@app.route('/mark_read', methods=['POST'])

def mark_read():

    data   = request.json

    reader = norm(data.get('user', ''))

    sender = norm(data.get('sender', ''))

    conn = get_db(); cur = conn.cursor()

    cur.execute(

        "UPDATE unread SET count=0 WHERE LOWER(reader)=LOWER(%s) AND LOWER(sender)=LOWER(%s)",

        (reader, sender)

    )

    conn.commit(); cur.close(); conn.close()

    return jsonify({"status": "success"})


# ===================== STATIC FILES =====================

@app.route('/')
def serve_index():
    return send_from_directory(resource_path('frontend'), 'index.html')

@app.route('/<path:path>')
def serve_files(path):
    return send_from_directory(resource_path('frontend'), path)


# ===================== SOCKET =====================



@socketio.on('connect')

def handle_connect():

    print(f"[SOCKET] Connected: {request.sid}")



@socketio.on('disconnect')

def handle_disconnect():

    print(f"[SOCKET] Disconnected: {request.sid}")



@socketio.on('join_user')

def on_join_user(data):

    user = norm(data.get('user', ''))

    join_room(f"user_{user}")



@socketio.on('join_chat')

def on_join_chat(data):

    u1 = norm(data.get('user1', ''))

    u2 = norm(data.get('user2', ''))

    room = '__'.join(sorted([u1, u2]))

    join_room(room)


def open_browser():
    """
    Instead of a fixed sleep, poll until the server is actually up,
    then open the browser. Much faster than a hardcoded 3s wait.
    """
    import urllib.request
    import time
    for _ in range(30):          # try for up to 15 seconds
        try:
            urllib.request.urlopen("http://127.0.0.1:5000/", timeout=1)
            break                # server is up — open immediately
        except:
            time.sleep(0.5)      # not ready yet — wait 500ms and retry
    webbrowser.open("http://127.0.0.1:5000")


if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    threading.Thread(target=open_browser, daemon=True).start()
    print("🔥 Server starting on http://127.0.0.1:5000")
    socketio.run(app, debug=False, host='127.0.0.1', port=5000)