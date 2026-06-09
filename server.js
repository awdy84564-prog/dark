const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

const GLOBAL_OWNER_NAME = "DARK CHAT";
const GLOBAL_OWNER_PASS = "DARK_CHAT_2026";

let rooms = {
    "room1": { id: "room1", name: "الديوانية العامة", activeUsers: 0, broadcaster: null, bg: "", ownerName: "", ownerPass: "" },
    "room2": { id: "room2", name: "غرفة المسابقات والفعاليات", activeUsers: 0, broadcaster: null, bg: "", ownerName: "", ownerPass: "" },
    "room3": { id: "room3", name: "جلسة طرب وعزف", activeUsers: 0, broadcaster: null, bg: "", ownerName: "", ownerPass: "" }
};
io.on('connection', (socket) => {
    socket.emit('init-rooms', Object.values(rooms));

    const updateRoomUsers = (roomId) => {
        const clients = io.sockets.adapter.rooms.get(roomId);
        const usersList = [];
        if (clients) {
            for (const clientId of clients) {
                const clientSocket = io.sockets.sockets.get(clientId);
                if (clientSocket && clientSocket.username) {
                    usersList.push({ username: clientSocket.username, role: clientSocket.role });
                }
            }
        }
        io.to(roomId).emit('room-users-list', usersList);
    };

    socket.on('join-chat', (data) => {
        const room = rooms[data.roomId];
        if (!room) return;

        if (data.username === GLOBAL_OWNER_NAME && data.password === GLOBAL_OWNER_PASS) {
            socket.username = GLOBAL_OWNER_NAME;
            socket.role = "GLOBAL_OWNER";
        } else if (room.ownerName && data.username === room.ownerName && data.password === room.ownerPass) {
            socket.username = room.ownerName;
            socket.role = "ROOM_OWNER";
        } else {
            socket.username = data.username || 'زائر';
            socket.role = "USER";
        }
        socket.currentRoom = data.roomId;
        socket.join(data.roomId);
        room.activeUsers++;
        
        io.emit('update-rooms', Object.values(rooms));
        socket.emit('role-assigned', { role: socket.role, roomName: room.name, roomBg: room.bg });
        
        let prefix = "👤 ";
        if (socket.role === "GLOBAL_OWNER") prefix = "👑 المالك العام ";
        if (socket.role === "ROOM_OWNER") prefix = "⭐ مالك الغرفة ";
        
        io.to(data.roomId).emit('sys-message', `${prefix} ${socket.username} انضم إلى الغرفة`);
        updateRoomUsers(data.roomId);

        if (room.broadcaster) {
            socket.emit('mic-started', { name: room.broadcasterName });
        }
    });

    socket.on('send-msg', (data) => {
        if (socket.currentRoom) {
            io.to(socket.currentRoom).emit('new-msg', {
                user: socket.username,
                role: socket.role,
                text: data.text
            });
        }
    });

    socket.on('start-mic', () => {
        const room = rooms[socket.currentRoom];
        if (room && !room.broadcaster && (socket.role === "GLOBAL_OWNER" || socket.role === "ROOM_OWNER")) {
            room.broadcaster = socket.id;
            room.broadcasterName = socket.username;
            socket.to(socket.currentRoom).emit('mic-started', { name: socket.username });
        }
    });
    socket.on('stop-mic', () => {
        const room = rooms[socket.currentRoom];
        if (room && room.broadcaster === socket.id) {
            room.broadcaster = null;
            room.broadcasterName = null;
            io.to(socket.currentRoom).emit('mic-stopped');
        }
    });

    socket.on('audio-data', (data) => {
        const room = rooms[socket.currentRoom];
        if (room && room.broadcaster === socket.id) {
            socket.to(socket.currentRoom).emit('audio-stream', data);
        }
    });

    socket.on('update-room-settings', (data) => {
        const room = rooms[socket.currentRoom];
        if (room && (socket.role === "GLOBAL_OWNER" || socket.role === "ROOM_OWNER")) {
            if (data.roomName) room.name = data.roomName;
            if (data.roomBg) room.bg = data.roomBg;
            io.to(socket.currentRoom).emit('room-settings-updated', { name: room.name, bg: room.bg });
            io.emit('update-rooms', Object.values(rooms));
        }
    });

    socket.on('clear-room-chat', () => {
        const room = rooms[socket.currentRoom];
        if (room && (socket.role === "GLOBAL_OWNER" || socket.role === "ROOM_OWNER")) {
            io.to(socket.currentRoom).emit('room-chat-cleared');
        }
    });

    socket.on('assign-room-owner', (data) => {
        const room = rooms[socket.currentRoom];
        if (room && (socket.role === "GLOBAL_OWNER" || socket.role === "ROOM_OWNER")) {
            room.ownerName = data.targetUser;
            room.ownerPass = data.targetPass;
        }
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            const roomId = socket.currentRoom;
            const room = rooms[roomId];
            if (room) {
                room.activeUsers = Math.max(0, room.activeUsers - 1);
                if (room.broadcaster === socket.id) {
                    room.broadcaster = null;
                    room.broadcasterName = null;
                    io.to(roomId).emit('mic-stopped');
                }
                io.emit('update-rooms', Object.values(rooms));
            }
            if (socket.username) {
                let prefix = "👤 ";
                if (socket.role === "GLOBAL_OWNER") prefix = "👑 المالك العام ";
                if (socket.role === "ROOM_OWNER") prefix = "⭐ مالك الغرفة ";
                io.to(roomId).emit('sys-message', `${prefix} ${socket.username} غادر الغرفة`);
            }
            updateRoomUsers(roomId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});
