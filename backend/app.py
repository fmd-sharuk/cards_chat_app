from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2
from flask_socketio import SocketIO, emit, join_room

from cards_hash import generate_final_key, joker
from cards_cipher import encrypt, decrypt

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# DB
conn = psycopg2.connect(
    "postgresql://postgres.leauancameamfgfgzyjt:fmdsharuk29@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
)
cursor = conn.cursor()

# ================= AUTH =================

@app.route('/signup', methods=['POST'])
def signup():
    data = request.json
    username = data['username']
    password = data['password']

    cursor.execute("SELECT * FROM users WHERE username=%s", (username,))
    if cursor.fetchone():
        return jsonify({"status": "error", "message": "User exists"})

    j = joker()
    final_key = generate_final_key(password, j)

    cursor.execute(
        "INSERT INTO users (username, password_hash, joker) VALUES (%s,%s,%s)",
        (username, final_key, j)
    )
    conn.commit()

    return jsonify({"status": "success"})


@app.route('/login', methods=['POST'])
def login():
    data = request.json
    username = data['username']
    password = data['password']

    cursor.execute(
        "SELECT password_hash, joker FROM users WHERE LOWER(username)=LOWER(%s)",
        (username,)
    )
    user = cursor.fetchone()

    if not user:
        return jsonify({"status": "error", "message": "User not found"})

    stored_hash, stored_joker = user
    final_key = generate_final_key(password, stored_joker)

    if final_key == stored_hash:
        return jsonify({"status": "success"})
    else:
        return jsonify({"status": "error"})


# ================= FRIEND SYSTEM =================

@app.route('/add_friend', methods=['POST'])
def add_friend():
    data = request.json
    user1 = data.get('user1')
    user2 = data.get('user2')

    if user1 == user2:
        return jsonify({"status": "error", "message": "Cannot add yourself"})

    # check user exists
    cursor.execute("SELECT username FROM users WHERE LOWER(username)=LOWER(%s)", (user2,))
    if not cursor.fetchone():
        return jsonify({"status": "error", "message": "User not found"})

    # Check for existing relationship in either direction
    cursor.execute("""
        SELECT user1, user2, status FROM friends
        WHERE (user1=%s AND user2=%s) OR (user1=%s AND user2=%s)
    """, (user1, user2, user2, user1))
    existing = cursor.fetchone()

    if existing:
        e_user1, e_user2, status = existing
        if status == 'accepted':
            return jsonify({"status": "exists", "message": "Already friends"})
        if status == 'pending':
            # Check which direction the pending request is
            if e_user1 == user2 and e_user2 == user1:
                return jsonify({"status": "exists", "message": "User already sent request to you. Please accept it instead."})
            else:
                return jsonify({"status": "exists", "message": "Request already sent"})

    cursor.execute(
        "INSERT INTO friends (user1, user2, status) VALUES (%s,%s,'pending')",
        (user1, user2)
    )
    conn.commit()

    # 🔥 realtime notify receiver
    socketio.emit("friend_request", {"to": user2})

    return jsonify({"status": "success", "message": "Request sent"})


@app.route('/get_requests', methods=['POST'])
def get_requests():
    user = request.json.get('user')

    cursor.execute("""
        SELECT user1 FROM friends
        WHERE user2 = %s AND status = 'pending'
    """, (user,))

    return jsonify([row[0] for row in cursor.fetchall()])


@app.route('/get_sent_requests', methods=['POST'])
def get_sent_requests():
    user = request.json.get('user')

    cursor.execute("""
        SELECT user2 FROM friends
        WHERE user1 = %s AND status = 'pending'
    """, (user,))

    return jsonify([row[0] for row in cursor.fetchall()])


@app.route('/accept_friend', methods=['POST'])
def accept_friend():
    data = request.json
    user = data['user1']  # The user accepting
    sender = data['user2']  # The user who sent the request

    # Update the existing pending request (which should be sender->user)
    cursor.execute("""
        UPDATE friends
        SET status='accepted'
        WHERE user1=%s AND user2=%s AND status='pending'
    """, (sender, user))
    
    if cursor.rowcount == 0:
        return jsonify({"status": "error", "message": "No pending request found"})
    
    conn.commit()

    # 🔥 realtime update both users
    socketio.emit("friend_update", {"user": user})
    socketio.emit("friend_update", {"user": sender})

    return jsonify({"status": "accepted"})


@app.route('/friends/<user>', methods=['GET'])
def get_friends(user):
    cursor.execute("""
        SELECT user1, user2 FROM friends
        WHERE (user1=%s OR user2=%s) AND status='accepted'
    """, (user, user))

    rows = cursor.fetchall()

    friends = []
    for u1, u2 in rows:
        friends.append(u2 if u1 == user else u1)

    return jsonify(friends)


# ================= CHAT =================

SECRET_KEY = "cards_secret_key"

@app.route('/send_message', methods=['POST'])
def send_message():
    data = request.json
    sender = data['sender']
    receiver = data['receiver']
    message = data['message']

    encrypted = encrypt(message, SECRET_KEY)

    cursor.execute(
        "INSERT INTO messages (sender, receiver, message) VALUES (%s,%s,%s)",
        (sender, receiver, encrypted)
    )
    conn.commit()

    room = f"{sender}__{receiver}"
    room_reverse = f"{receiver}__{sender}"

    socketio.emit("receive_message", {
        "sender": sender,
        "message": message
    }, room=room)
    socketio.emit("receive_message", {
        "sender": sender,
        "message": message
    }, room=room_reverse)

    return jsonify({"status": "sent"})

@socketio.on("send_message")
def handle_send_message(data):
    room = data["room"]

    emit("receive_message", {
        "sender": data["sender"],
        "message": data["message"]
    }, room=room)

@app.route('/messages/<user1>/<user2>', methods=['GET'])
def get_messages(user1, user2):
    cursor.execute("""
        SELECT sender, message FROM messages
        WHERE (sender=%s AND receiver=%s)
        OR (sender=%s AND receiver=%s)
        ORDER BY id ASC
    """, (user1, user2, user2, user1))

    rows = cursor.fetchall()

    return jsonify([
        {"sender": s, "message": decrypt(m, SECRET_KEY)}
        for s, m in rows
    ])


@socketio.on("join")
def on_join(data):
    room = data["room"]
    join_room(room)
    # Also join reverse room to ensure bidirectional chat receives messages
    # Extract users from room and join reverse too
    if "__" in room:
        parts = room.split("__")
        if len(parts) == 2:
            reverse_room = f"{parts[1]}__{parts[0]}"
            join_room(reverse_room)

if __name__ == "__main__":
    socketio.run(app, debug=True)