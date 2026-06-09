const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let currentBroadcaster = null;
const OWNER_NAME = "DARK CHAT";
const OWNER_PASS = "DARK_CHAT_2026";

io.on('connection', (socket) => {
    socket.emit('init-state', {
        hasBroadcaster: currentBroadcaster !== null,
        broadcasterId: currentBroadcaster
    });

    socket.on('join-chat', (data) => {
        if (data.username === OWNER_NAME && data.password === OWNER_PASS) {
            socket.username = OWNER_NAME;
            socket.role = "OWNER";
            socket.emit('role-assigned', { role: "OWNER" });
            io.emit('sys-message', `👑 OWNER ${socket.username} has entered the room`);
        } else {
            socket.username = data.username || 'Guest';
            socket.role = "USER";
            socket.emit('role-assigned', { role: "USER" });
            io.emit('sys-message', `👤 ${socket.username} joined the chat`);
        }
    });

    socket.on('send-msg', (data) => {
        io.emit('new-msg', {
            user: socket.username || 'Guest',
            role: socket.role || 'USER',
            text: data.text
        });
    });

    socket.on('start-mic', () => {
        if (socket.role === "OWNER" && !currentBroadcaster) {
            currentBroadcaster = socket.id;
            socket.broadcast.emit('mic-started', socket.id);
        } else if (socket.role !== "OWNER") {
            socket.emit('sys-message', "❌ Only the Owner can use the mic");
        }
    });

    socket.on('stop-mic', () => {
        if (currentBroadcaster === socket.id) {
            currentBroadcaster = null;
            io.emit('mic-stopped');
        }
    });

    socket.on('audio-data', (data) => {
        if (currentBroadcaster === socket.id) {
            socket.broadcast.emit('audio-stream', data);
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            const prefix = socket.role === "OWNER" ? "👑 OWNER " : "👤 ";
            io.emit('sys-message', `${prefix}${socket.username} left the chat`);
        }
        if (currentBroadcaster === socket.id) {
            currentBroadcaster = null;
            io.emit('mic-stopped');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});
