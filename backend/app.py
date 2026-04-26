from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
import psycopg2
from cards_hash import generate_final_key, joker
from cards_cipher import encrypt, decrypt
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = 'cards_secret_key_2026'
CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Database connection
conn = psycopg2.connect(
    "postgresql://postgres.leauancameamfgfgzyjt:fmdsharuk29@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
)
cursor = conn.cursor()

# Ensure tables exist
def init_db():
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(256) NOT NULL,
            joker VARCHAR(256) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS friends (
            id SERIAL PRIMARY KEY,
            user1 VARCHAR(50) NOT NULL,
            user2 VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user1, user2)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(50) NOT NULL,
            receiver VARCHAR(50) NOT NULL,
            message TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

init_db()

def normalize_username(username):
    """Normalize username: lowercase, trim, alphanumeric only"""
    return re.sub(r'[^a-zA-Z0-9]', '', username.strip().lower())

# ================= AUTH =================

@app.route('/signup', methods=['POST'])
def signup():
    data = request.json
    raw_username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not raw_username or not password:
        return jsonify({"status": "error", "message": "Username and password required"}), 400
    
    if len(password) < 4:
        return jsonify({"status": "error", "message": "Password must be at least 4 characters"}), 400
    
    username = normalize_username(raw_username)
    
    if not username:
        return jsonify({"status": "error", "message": "Username must contain letters or numbers"}), 400
    
    # Check if username exists (case-insensitive)
    cursor.execute("SELECT username FROM users WHERE LOWER(username) = LOWER(%s)", (username,))
    if cursor.fetchone():
        return jsonify({"status": "error", "message": "Username already exists"}), 400
    
    # Generate CARDS hash
    j = joker()
    final_key = generate_final_key(password, j)
    
    cursor.execute(
        "INSERT INTO users (username, password_hash, joker) VALUES (%s, %s, %s) RETURNING id",
        (username, final_key, j)
    )
    conn.commit()
    
    print(f"[SIGNUP] New user: {username}")
    return jsonify({"status": "success", "message": "Account created successfully"})

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    raw_username = data.get('username', '').strip()
    password = data.get('password', '')
    
    username = normalize_username(raw_username)
    
    cursor.execute(
        "SELECT password_hash, joker FROM users WHERE LOWER(username) = LOWER(%s)",
        (username,)
    )
    user = cursor.fetchone()
    
    if not user:
        return jsonify({"status": "error", "message": "Invalid username or password"}), 401
    
    stored_hash, stored_joker = user
    final_key = generate_final_key(password, stored_joker)
    
    if final_key == stored_hash:
        print(f"[LOGIN] User logged in: {username}")
        return jsonify({"status": "success", "username": username})
    else:
        return jsonify({"status": "error", "message": "Invalid username or password"}), 401

# ================= FRIEND SYSTEM =================

@app.route('/search_users', methods=['POST'])
def search_users():
    """Search for users by username (excluding self and existing friends/requests)"""
    data = request.json
    current_user = normalize_username(data.get('user', ''))
    query = normalize_username(data.get('query', ''))
    
    if not query:
        return jsonify([])
    
    cursor.execute("""
        SELECT username FROM users
        WHERE LOWER(username) LIKE LOWER(%s)
        AND LOWER(username) != LOWER(%s)
        AND username NOT IN (
            SELECT CASE WHEN user1 = %s THEN user2 ELSE user1 END
            FROM friends
            WHERE (user1 = %s OR user2 = %s)
        )
        ORDER BY username
        LIMIT 20
    """, (f'%{query}%', current_user, current_user, current_user, current_user))
    
    results = [row[0] for row in cursor.fetchall()]
    return jsonify(results)

@app.route('/add_friend', methods=['POST'])
def add_friend():
    data = request.json
    user1 = normalize_username(data.get('user1', ''))
    user2 = normalize_username(data.get('user2', ''))
    
    if user1 == user2:
        return jsonify({"status": "error", "message": "Cannot add yourself"}), 400
    
    # Check if user2 exists
    cursor.execute("SELECT username FROM users WHERE LOWER(username) = LOWER(%s)", (user2,))
    if not cursor.fetchone():
        return jsonify({"status": "error", "message": "User not found"}), 404
    
    # Check for existing relationship in either direction
    cursor.execute("""
        SELECT user1, user2, status FROM friends
        WHERE (LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s))
           OR (LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s))
    """, (user1, user2, user2, user1))
    
    existing = cursor.fetchone()
    
    if existing:
        e_user1, e_user2, status = existing
        if status == 'accepted':
            return jsonify({"status": "error", "message": "Already friends"}), 400
        if status == 'pending':
            if e_user1.lower() == user2.lower() and e_user2.lower() == user1.lower():
                return jsonify({"status": "exists", "message": "They already sent you a request!"}), 200
            else:
                return jsonify({"status": "error", "message": "Request already sent"}), 400
    
    # Create pending request
    cursor.execute(
        "INSERT INTO friends (user1, user2, status) VALUES (%s, %s, 'pending')",
        (user1, user2)
    )
    conn.commit()
    
    print(f"[FRIEND] {user1} -> {user2} (pending)")
    
    # Notify receiver via socket
    socketio.emit('friend_request', {
        'from': user1,
        'to': user2
    }, room=f"user_{user2}")
    
    return jsonify({"status": "success", "message": "Friend request sent"})

@app.route('/get_requests', methods=['POST'])
def get_requests():
    """Get incoming friend requests"""
    user = normalize_username(request.json.get('user', ''))
    
    cursor.execute("""
        SELECT user1 FROM friends
        WHERE LOWER(user2) = LOWER(%s) AND status = 'pending'
        ORDER BY created_at DESC
    """, (user,))
    
    requests = [row[0] for row in cursor.fetchall()]
    return jsonify(requests)

@app.route('/get_sent_requests', methods=['POST'])
def get_sent_requests():
    """Get outgoing pending requests"""
    user = normalize_username(request.json.get('user', ''))
    
    cursor.execute("""
        SELECT user2 FROM friends
        WHERE LOWER(user1) = LOWER(%s) AND status = 'pending'
        ORDER BY created_at DESC
    """, (user,))
    
    sent = [row[0] for row in cursor.fetchall()]
    return jsonify(sent)

@app.route('/get_friends', methods=['POST'])
def get_friends():
    """Get accepted friends list"""
    user = normalize_username(request.json.get('user', ''))
    
    cursor.execute("""
        SELECT CASE WHEN LOWER(user1) = LOWER(%s) THEN user2 ELSE user1 END
        FROM friends
        WHERE (LOWER(user1) = LOWER(%s) OR LOWER(user2) = LOWER(%s))
          AND status = 'accepted'
        ORDER BY created_at DESC
    """, (user, user, user))
    
    friends = [row[0] for row in cursor.fetchall()]
    return jsonify(friends)

@app.route('/accept_friend', methods=['POST'])
def accept_friend():
    data = request.json
    current_user = normalize_username(data.get('user', ''))  # The accepter
    sender = normalize_username(data.get('sender', ''))  # The requester
    
    # Update the pending request
    cursor.execute("""
        UPDATE friends
        SET status = 'accepted'
        WHERE LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s) AND status = 'pending'
    """, (sender, current_user))
    
    if cursor.rowcount == 0:
        return jsonify({"status": "error", "message": "No pending request found"}), 400
    
    conn.commit()
    
    print(f"[FRIEND] {current_user} accepted request from {sender}")
    
    # Notify both users
    socketio.emit('friend_accepted', {
        'user1': sender,
        'user2': current_user
    }, room=f"user_{sender}")
    socketio.emit('friend_accepted', {
        'user1': sender,
        'user2': current_user
    }, room=f"user_{current_user}")
    
    return jsonify({"status": "success", "message": "Friend request accepted"})

@app.route('/remove_friend', methods=['POST'])
def remove_friend():
    """Remove/unfriend someone"""
    data = request.json
    user1 = normalize_username(data.get('user1', ''))
    user2 = normalize_username(data.get('user2', ''))
    
    cursor.execute("""
        DELETE FROM friends
        WHERE (LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s))
           OR (LOWER(user1) = LOWER(%s) AND LOWER(user2) = LOWER(%s))
    """, (user1, user2, user2, user1))
    conn.commit()
    
    return jsonify({"status": "success"})

# ================= MESSAGING =================

@app.route('/send_message', methods=['POST'])
def send_message():
    data = request.json
    sender = normalize_username(data.get('sender', ''))
    receiver = normalize_username(data.get('receiver', ''))
    message = data.get('message', '')
    
    if not message:
        return jsonify({"status": "error", "message": "Message cannot be empty"}), 400
    
    # Encrypt message
    secret_key = f"cards_chat_secret_{sender}_{receiver}"
    encrypted = encrypt(message, secret_key)
    
    cursor.execute(
        "INSERT INTO messages (sender, receiver, message) VALUES (%s, %s, %s)",
        (sender, receiver, encrypted)
    )
    conn.commit()
    
    # Send via socket to both directions
    room1 = f"chat_{sender}__{receiver}"
    room2 = f"chat_{receiver}__{sender}"
    
    socketio.emit('new_message', {
        'sender': sender,
        'receiver': receiver,
        'message': message,
        'encrypted': encrypted
    }, room=room1)
    socketio.emit('new_message', {
        'sender': sender,
        'receiver': receiver,
        'message': message,
        'encrypted': encrypted
    }, room=room2)
    
    print(f"[MSG] {sender} -> {receiver}: {message[:50]}...")
    return jsonify({"status": "success"})

@app.route('/messages/<user1>/<user2>', methods=['GET'])
def get_messages(user1, user2):
    """Get chat history between two users"""
    user1 = normalize_username(user1)
    user2 = normalize_username(user2)
    
    cursor.execute("""
        SELECT sender, receiver, message, sent_at
        FROM messages
        WHERE (LOWER(sender) = LOWER(%s) AND LOWER(receiver) = LOWER(%s))
           OR (LOWER(sender) = LOWER(%s) AND LOWER(receiver) = LOWER(%s))
        ORDER BY sent_at ASC
    """, (user1, user2, user2, user1))
    
    rows = cursor.fetchall()
    
    # Decrypt messages
    secret_key = f"cards_chat_secret_{user1}_{user2}"
    messages = []
    for sender, receiver, encrypted, sent_at in rows:
        try:
            decrypted = decrypt(encrypted, secret_key)
            messages.append({
                'sender': sender,
                'receiver': receiver,
                'message': decrypted,
                'sent_at': sent_at.isoformat()
            })
        except:
            messages.append({
                'sender': sender,
                'receiver': receiver,
                'message': '[encrypted message]',
                'sent_at': sent_at.isoformat()
            })
    
    return jsonify(messages)

# ================= SOCKET.IO =================

@socketio.on('connect')
def on_connect():
    print(f"[SOCKET] Client connected: {request.sid}")

@socketio.on('disconnect')
def on_disconnect():
    print(f"[SOCKET] Client disconnected: {request.sid}")

@socketio.on('join_user')
def on_join_user(data):
    """Join user-specific room for real-time notifications"""
    user = normalize_username(data.get('user', ''))
    room = f"user_{user}"
    join_room(room)
    print(f"[SOCKET] {request.sid} joined room: {room}")

@socketio.on('join_chat')
def on_join_chat(data):
    """Join chat room for messaging"""
    user1 = normalize_username(data.get('user1', ''))
    user2 = normalize_username(data.get('user2', ''))
    room1 = f"chat_{user1}__{user2}"
    room2 = f"chat_{user2}__{user1}"
    join_room(room1)
    join_room(room2)
    print(f"[SOCKET] {request.sid} joined chat rooms: {room1}, {room2}")

@socketio.on('typing')
def on_typing(data):
    """Broadcast typing indicator"""
    user1 = normalize_username(data.get('user1', ''))
    user2 = normalize_username(data.get('user2', ''))
    room1 = f"chat_{user1}__{user2}"
    room2 = f"chat_{user2}__{user1}"
    emit('user_typing', data, room=room1, include_self=False)
    emit('user_typing', data, room=room2, include_self=False)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
