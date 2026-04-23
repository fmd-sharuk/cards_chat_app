const API = "http://127.0.0.1:5000";
const socket = io(API);

// =====================
// AUTH
// =====================
function login() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    fetch(API + "/login", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username, password})
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            localStorage.setItem("user", username);
            window.location.href = "home.html";
        } else {
            alert(data.message);
        }
    });
}

function signup() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    fetch(API + "/signup", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username, password})
    })
    .then(res => res.json())
    .then(data => alert(data.message || data.status));
}

// =====================
// HOME INIT
// =====================
if (window.location.pathname.includes("home.html")) {
    const user = localStorage.getItem("user");
    document.getElementById("userDisplay").innerText = "👤 " + user;

    loadFriends();
    loadRequests();
}

// =====================
// ADD FRIEND
// =====================
function addFriend() {
    const user1 = localStorage.getItem("user");
    const user2 = document.getElementById("friendInput").value.trim();

    // Safety checks
    if (!user2) return;
    if (user1 === user2) {
        alert("Cannot add yourself as a friend");
        return;
    }

    fetch(API + "/add_friend", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user1: user1, user2: user2 })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            document.getElementById("friendInput").value = "";
            loadRequests();
        }
        alert(data.message);
    });
}

// =====================
// LOAD FRIENDS
// =====================
function loadFriends() {
    const user = localStorage.getItem("user");

    fetch(API + "/get_friends", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user })
    })
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById("friendList");
        list.innerHTML = "";

        if (data.length === 0) {
            const div = document.createElement("div");
            div.innerText = "No friends";
            list.appendChild(div);
            return;
        }

        data.forEach(f => {
            const div = document.createElement("div");
            div.className = "friend";
            div.innerText = f;

            div.onclick = () => {
                localStorage.setItem("chatWith", f);
                window.location.href = "chat.html";
            };

            list.appendChild(div);
        });
    });
}

// =====================
// LOAD REQUESTS
// =====================
function loadRequests() {
    const user = localStorage.getItem("user");

    fetch(API + "/get_requests", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user })
    })
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById("requestList");
        list.innerHTML = "";

        if (data.length === 0) {
            const div = document.createElement("div");
            div.innerText = "No requests";
            list.appendChild(div);
            return;
        }

        data.forEach(r => {
            const div = document.createElement("div");
            div.innerText = r;

            const btn = document.createElement("button");
            btn.innerText = "Accept";

            btn.onclick = () => {
                acceptRequest(r);
            };

            div.appendChild(btn);
            list.appendChild(div);
        });
    });
}

// =====================
// ACCEPT FRIEND
// =====================
function acceptRequest(sender) {
    const user1 = localStorage.getItem("user");
    const user2 = sender;

    fetch(API + "/accept_friend", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({user1, user2})
    })
    .then(() => {
        loadFriends();
        loadRequests();
    });
}

// =====================
// CHAT INIT
// =====================
if (window.location.pathname.includes("chat.html")) {
    const user = localStorage.getItem("user");
    const friend = localStorage.getItem("chatWith");

    if (!friend) {
        alert("No friend selected");
        window.location.href = "home.html";
    }

    document.title = "Chat with " + friend;

    const room = [user, friend].sort().join("_");
    socket.emit("join", {room});

    loadMessages();

    socket.on("receive_message", (data) => {
        appendMessage(data.sender, data.message);
    });
}

// =====================
// SEND MESSAGE
// =====================
function sendMessage() {
    const sender = localStorage.getItem("user");
    const receiver = localStorage.getItem("chatWith");
    const message = document.getElementById("msgInput").value;

    if (!message) return;

    fetch(API + "/send_message", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({sender, receiver, message})
    });

    document.getElementById("msgInput").value = "";
}

// =====================
// LOAD OLD MESSAGES
// =====================
function loadMessages() {
    const user1 = localStorage.getItem("user");
    const user2 = localStorage.getItem("chatWith");

    fetch(API + "/get_messages", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({user1, user2})
    })
    .then(res => res.json())
    .then(data => {
        const box = document.getElementById("messages");
        box.innerHTML = "";

        data.forEach(msg => {
            appendMessage(msg.sender, msg.message);
        });
    });
}

// =====================
// UI APPEND
// =====================
function appendMessage(sender, message) {
    const box = document.getElementById("messages");

    const div = document.createElement("div");
    div.className = sender === localStorage.getItem("user") ? "me" : "other";
    div.innerText = message;

    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

