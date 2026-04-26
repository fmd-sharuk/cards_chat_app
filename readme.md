# 📨 Cards Chat - Netflix-Style Encrypted Messaging

A full-stack, end-to-end encrypted chat application with Instagram-style interface.

## 🌟 Features

- **End-to-End Encryption**: All messages encrypted using CARDS cipher algorithm
- **Secure Authentication**: CARDS hashing algorithm for password security
- **Real-Time Messaging**: Instant chat with Socket.IO
- **Friend System**: Send/receive/accept friend requests
- **User Search**: Find and add anyone by username
- **Netflix-Style UI**: Dark theme with smooth animations
- **Multi-Device Support**: Each tab maintains independent session

## 🛠️ Tech Stack

**Backend:**
- Python 3.x
- Flask (Web Framework)
- Flask-SocketIO (Real-time communication)
- PostgreSQL (Database)
- Custom CARDS Hash & Cipher algorithms

**Frontend:**
- HTML5, CSS3, Vanilla JavaScript
- Socket.IO Client
- Netflix-inspired design

## 🚀 Quick Start

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
python app.py
```

### Frontend

Open `frontend/index.html` in your browser (or use a local HTTP server).

**Note:** Flask backend runs on port 5000. Update `API` constant in `app.js` if needed.

## 🔐 Security

### Authentication
- Passwords hashed using custom CARDS algorithm with salt (joker)
- Case-insensitive username handling
- Session-based authentication via sessionStorage

### Encryption
- Messages encrypted with CARDS cipher before storage
- Unique encryption key per conversation: `cards_chat_secret_{user1}_{user2}`
- End-to-end encryption in transit (Socket.IO) and at rest (DB)

## 📁 Project Structure

```
CARDS_ERA_7/
├── backend/
│   ├── app.py              # Main Flask application
│   ├── cards_hash.py       # CARDS hashing algorithm
│   ├── cards_cipher.py     # CARDS cipher encryption
│   └── requirements.txt    # Python dependencies
└── frontend/
    ├── index.html          # Login/Signup page
    ├── home.html           # Main chat interface
    ├── chat.html           # Direct chat view
    ├── app.js              # Application logic
    └── style.css           # Netflix-style theme
```

## 🎨 UI Components

### Login Page (index.html)
- Username/Password authentication
- Account creation
- Toggle between Login/Signup

### Main Interface (home.html)
- User profile with logout
- User search with autocomplete
- Three sections:
  - **Friends**: Active conversations
  - **Requests**: Incoming friend requests
  - **Sent**: Outgoing pending requests
- Real-time notifications
- 3-second auto-refresh

### Chat Interface
- End-to-end encrypted messaging
- Real-time typing indicators
- Message history with timestamps
- Online/offline status

## 🔧 API Endpoints

### Authentication
- `POST /signup` - Create account
- `POST /login` - Authenticate user

### Friends
- `POST /search_users` - Search users
- `POST /add_friend` - Send friend request
- `POST /get_requests` - Get incoming requests
- `POST /get_sent_requests` - Get outgoing requests
- `POST /get_friends` - Get friends list
- `POST /accept_friend` - Accept request
- `POST /remove_friend` - Remove friend

### Messaging
- `POST /send_message` - Send message
- `GET /messages/<user1>/<user2>` - Get chat history

### Socket.IO Events
- `join_user` - Join user notification room
- `join_chat` - Join chat room
- `friend_request` - New friend request
- `friend_accepted` - Request accepted
- `new_message` - New message
- `user_typing` - Typing indicator

## 🎯 Key Design Decisions

1. **sessionStorage for Isolation**: Each tab has independent session (prevents cross-tab contamination)

2. **Dual-Room Chat**: Messages sent to both `chat_user1__user2` and `chat_user2__user1` rooms for reliability

3. **Auto-Refresh**: 3-second polling keeps UI in sync across devices

4. **Real-Time First**: Socket.IO for instant updates, HTTP fallback for reliability

5. **Netflix Aesthetic**: Dark theme, smooth animations, clean typography

## 🔒 Privacy & Security Notes

- Messages encrypted before leaving client
- Passwords never stored in plaintext
- Session isolation prevents account mixing
- No message logging on server (encrypted blobs only)
- HTTPS recommended for production

## 🐛 Known Limitations

- PostgreSQL database requires external hosting (Supabase in config)
- No file/media attachments (text-only)
- No group chats (1:1 only)
- No message deletion/editing
- No read receipts (but online status available)

## 📝 License

Educational project - CARDS encryption demonstration

## 🙏 Credits

- CARDS Hash & Cipher algorithms: Custom implementation
- UI Design: Inspired by Netflix & Instagram
- Real-time layer: Socket.IO
