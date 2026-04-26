from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
import psycopg2
import psycopg2.extras
from cards_hash import generate_final_key, joker
from cards_cipher import encrypt, decrypt
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = 'cards_secret_key_2026'
CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

def get_db():
    conn = psycopg2.connect(
        "postgresql://postgres.leauancameamfgfgzyjt:fmdsharuk29@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
    )
    return conn

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
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS friends (
            id SERIAL PRIMARY KEY,
            user1 VARCHAR(50) NOT NULL,
            user2 VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user1, user2)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(50) NOT NULL,
            receiver VARCHAR(50) NOT NULL,
            message TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    cur.close()
    conn.close()

init_db()

def norm(user):
    return re.sub(r'[^a-zA-Z0-9]', '', str(user).strip().lower())

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
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT username FROM users WHERE LOWER(username) = LOWER(%s)", (username,))
    if cur.fetchone():
        cur.close()
        conn.close()
        return jsonify({"status": "error", "message": "Username exists"}), 400
    j = joker()
    h = generate_final_key(pwd, j)
    cur.execute("INSERT INTO users (username, password_hash, joker) VALUES (%s, %s, %s)", (username, h, j))
    conn.commit()
    cur.close()
    conn.close()
    print(f"[SIGNUP] {username}")
    return jsonify({"status": "success", "message": "Account created"})

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    username = norm(data.get('username', ''))
    password = data.get('password', '')
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT password_hash, joker FROM users WHERE LOWER(username) = LOWER(%s)", (username,))
    u = cur.fetchone()
    cur.close()
    conn.close()
    if not u:
        return jsonify({"status": "error", "message": "Invalid"}), 401
    h, j = u
    if generate_final_key(password, j) == h:
        print(f"[LOGIN] {username}")
        return jsonify({"status": "success", "username": username})
    return jsonify({"status": "error", "message": "Invalid"}), 401

@app.route('/search_users', methods=['POST'])
def search_users():
    data = request.json
    me = norm(data.get('user', ''))
    q = norm(data.get('query', ''))
    if not q:
        return jsonify([])
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT username FROM users
        WHERE LOWER(username) LIKE LOWER(%s)
        AND LOWER(username) != LOWER(%s)
        AND username NOT IN (
            SELECT CASE WHEN user1 = %s THEN user2 ELSE user1 END
            FROM friends WHERE (user1 = %s OR user2 = %s)
        )
        ORDER BY username LIMIT 20
    """, (f'%{q}%', me, me, me, me))
    r = [row[0] for row in cur.fetchall()]
    cur.close()
    conn.close()
    return jsonify(r)

@app.route('/add_friend', methods=['POST'])
def add_friend():
    data = request.json
    u1 = norm(data.get('user1', ''))
    u2 = norm(data.get('user2', ''))
    if u1 == u2:
        return jsonify({"status": "error", "message": "Cannot add yourself"}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT username FROM users WHERE LOWER(username) = LOWER(%s)", (u2,))
    if not cur.fetchone():
        cur.close()
        conn.close()
        return jsonify({"status": "error", "message": "User not found"}), 404
    cur.execute("""
        SELECT user1, user2, status FROM friends
        WHERE (LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s))
           OR (LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s))
    """, (u1, u2, u2, u1))
    ex = cur.fetchone()
    if ex:
        e1, e2, st = ex
        if st == 'accepted':
            cur.close()
            conn.close()
            return jsonify({"status": "error", "message": "Already friends"}), 400
        if st == 'pending' and e1.lower() == u2.lower() and e2.lower() == u1.lower():
            cur.close()
            conn.close()
            return jsonify({"status": "exists", "message": "They sent you a request!"}), 200
        cur.close()
        conn.close()
        return jsonify({"status": "error", "message": "Request exists"}), 400
    cur.execute("INSERT INTO friends (user1, user2, status) VALUES (%s, %s, 'pending')", (u1, u2))
    conn.commit()
    cur.close()
    conn.close()
    print(f"[FRIEND] {u1} -> {u2}")
    socketio.emit('friend_request', {'from': u1, 'to': u2}, room=f"user_{u2}")
    return jsonify({"status": "success", "message": "Request sent"})

@app.route('/get_requests', methods=['POST'])
def get_requests():
    user = norm(request.json.get('user', ''))
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT user1 FROM friends WHERE LOWER(user2) = LOWER(%s) AND status = 'pending'", (user,))
    r = [row[0] for row in cur.fetchall()]
    cur.close()
    conn.close()
    return jsonify(r)

@app.route('/get_sent_requests', methods=['POST'])
def get_sent_requests():
    user = norm(request.json.get('user', ''))
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT user2 FROM friends WHERE LOWER(user1) = LOWER(%s) AND status = 'pending'", (user,))
    r = [row[0] for row in cur.fetchall()]
    cur.close()
    conn.close()
    return jsonify(r)

@app.route('/get_friends', methods=['POST'])
def get_friends():
    user = norm(request.json.get('user', ''))
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT CASE WHEN LOWER(user1) = LOWER(%s) THEN user2 ELSE user1 END
        FROM friends
        WHERE (LOWER(user1) = LOWER(%s) OR LOWER(user2) = LOWER(%s))
          AND status = 'accepted'
    """, (user, user, user))
    r = [row[0] for row in cur.fetchall()]
    cur.close()
    conn.close()
    return jsonify(r)

@app.route('/accept_friend', methods=['POST'])
def accept_friend():
    data = request.json
    me = norm(data.get('user', ''))
    sender = norm(data.get('sender', ''))
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE friends SET status = 'accepted' WHERE LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s) AND status = 'pending'", (sender, me))
    if cur.rowcount == 0:
        cur.close()
        conn.close()
        return jsonify({"status": "error", "message": "No request"}), 400
    conn.commit()
    cur.close()
    conn.close()
    print(f"[ACCEPT] {me} <- {sender}")
    socketio.emit('friend_accepted', {'user1': sender, 'user2': me}, room=f"user_{sender}")
    socketio.emit('friend_accepted', {'user1': sender, 'user2': me}, room=f"user_{me}")
    return jsonify({"status": "success", "message": "Accepted"})

@app.route('/remove_friend', methods=['POST'])
def remove_friend():
    data = request.json
    u1 = norm(data.get('user1', ''))
    u2 = norm(data.get('user2', ''))
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM friends WHERE (LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s)) OR (LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s))", (u1, u2, u2, u1))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "success"})

@socketio.on('send_message')
def handle_send_message(data):
    sender = norm(data.get('sender', ''))
    receiver = norm(data.get('receiver', ''))
    message = data.get('message', '')
    if not sender or not receiver or not message:
        return
    room = '__'.join(sorted([sender, receiver]))
    key = f"cards_{min(sender, receiver)}_{max(sender, receiver)}"
    encrypted = encrypt(message, key)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("INSERT INTO messages (sender, receiver, message) VALUES (%s, %s, %s)", (sender, receiver, encrypted))
    conn.commit()
    cur.close()
    conn.close()
    socketio.emit('receive_message', {'sender': sender, 'receiver': receiver, 'message': message}, room=room)
    print(f'[MSG] {sender} -> {receiver} via socket')

@app.route('/send_message', methods=['POST'])
def send_message():
    return jsonify({"status": "error", "message": "Use socket"}), 400

@app.route('/messages/<u1>/<u2>', methods=['GET'])
def get_messages(u1, u2):
    u1n = norm(u1)
    u2n = norm(u2)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT sender, receiver, message, sent_at
        FROM messages
        WHERE (LOWER(sender) = LOWER(%s) AND LOWER(receiver) = LOWER(%s))
           OR (LOWER(sender) = LOWER(%s) AND LOWER(receiver) = LOWER(%s))
        ORDER BY sent_at
    """, (u1n, u2n, u2n, u1n))
    rows = cur.fetchall()
    key1 = f"cards_{min(u1n, u2n)}_{max(u1n, u2n)}"
    key2 = f"cards_{u1n}_{u2n}"
    key3 = f"cards_{u2n}_{u1n}"
    msgs = []
    for s, r, m, t in rows:
        decrypted = None
        for key in [key1, key2, key3]:
            try:
                decrypted = decrypt(m, key)
                break
            except:
                continue
        if decrypted:
            msgs.append({'sender': s, 'receiver': r, 'message': decrypted, 'sent_at': t.isoformat()})
        else:
            msgs.append({'sender': s, 'receiver': r, 'message': '[encrypted]', 'sent_at': t.isoformat()})
    cur.close()
    conn.close()
    return jsonify(msgs)

@socketio.on('connect')
def on_connect():
    print(f"[SOCKET] Connected: {request.sid}")

@socketio.on('disconnect')
def on_disconnect():
    print(f"[SOCKET] Disconnected: {request.sid}")

@socketio.on('join_user')
def on_join_user(data):
    user = norm(data.get('user', ''))
    join_room(f"user_{user}")
    print(f"[JOIN] {request.sid} -> user_{user}")

@socketio.on('join_chat')
def on_join_chat(data):
    u1 = norm(data.get('user1', ''))
    u2 = norm(data.get('user2', ''))
    room = '__'.join(sorted([u1, u2]))
    join_room(room)
    print(f'[JOIN] {request.sid} -> {room}')

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
