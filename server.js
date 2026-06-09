const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

let currentBroadcaster = null;

io.on('connection', (socket) => {
    socket.emit('init-state', {
        hasBroadcaster: currentBroadcaster !== null,
        broadcasterId: currentBroadcaster
    });
    socket.on('join-chat', (username) => {
        socket.username = username;
        io.emit('sys-message', `${username} joined the chat`);
    });

    socket.on('send-msg', (data) => {
        io.emit('new-msg', {
            user: socket.username || 'Guest',
            text: data.text
        });
    });

    socket.on('start-mic', () => {
        if (!currentBroadcaster) {
            currentBroadcaster = socket.id;
            socket.broadcast.emit('mic-started', socket.id);
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
            io.emit('sys-message', `${socket.username} left the chat`);
        }
        if (currentBroadcaster === socket.id) {
            currentBroadcaster = null;
            io.emit('mic-stopped');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});
