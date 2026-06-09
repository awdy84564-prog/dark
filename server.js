const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

const SUPER_ADMIN = "DARK CHAT";
const SUPER_PASS = "DARK_CHAT_2026";

let rooms = [
    { id: "room1", name: "الديوانية العامة", activeUsers: 0, broadcaster: null, pass: "1111", bg: "", mods: [] },
    { id: "room2", name: "غرفة المسابقات والفعاليات", activeUsers: 0, broadcaster: null, pass: "2222", bg: "", mods: [] },
    { id: "room3", name: "جلسة طرب وعزف", activeUsers: 0, broadcaster: null, pass: "3333", bg: "", mods: [] }
];
io.on('connection', (socket) => {
    socket.emit('init-rooms', rooms.map(r => ({ id: r.id, name: r.name, activeUsers: r.activeUsers })));

    const updateRoomUsers = (roomId) => {
        const clients = io.sockets.adapter.rooms.get(roomId);
        const usersList = [];
        if (clients) {
            for (const clientId of clients) {
                const clientSocket = io.sockets.sockets.get(clientId);
                if (clientSocket && clientSocket.username) {
                    usersList.push({ id: clientSocket.id, username: clientSocket.username, role: clientSocket.role });
                }
            }
        }
        io.to(roomId).emit('room-users-list', usersList);
    };

    socket.on('join-chat', (data) => {
        const room = rooms.find(r => r.id === data.roomId);
        if (!room) return;

        let assignedRole = "USER";

        if (data.username === SUPER_ADMIN && data.password === SUPER_PASS) {
            assignedRole = "OWNER";
        } else if (data.password === room.pass) {
            assignedRole = "OWNER";
        } else if (room.mods.includes(data.username)) {
            assignedRole = "MOD";
        }

        socket.username = data.username || 'زائر';
        socket.role = assignedRole;
        socket.currentRoom = data.roomId;
        socket.join(data.roomId);
        
        room.activeUsers++;
        io.emit('update-rooms', rooms.map(r => ({ id: r.id, name: r.name, activeUsers: r.activeUsers })));

        socket.emit('role-assigned', { role: socket.role, roomName: room.name, bg: room.bg });
        
        let prefix = "👤 ";
        if(socket.role === "OWNER") prefix = "👑 المالك ";
        if(socket.role === "MOD") prefix = "👮 المشرف ";
        
        io.to(data.roomId).emit('sys-message', `${prefix} ${socket.username} انضم إلى الغرفة`);
        updateRoomUsers(data.roomId);

        if (room.broadcaster) socket.emit('mic-started');
    });

    socket.on('send-msg', (data) => {
        if (socket.currentRoom) {
            io.to(socket.currentRoom).emit('new-msg', { user: socket.username, role: socket.role, text: data.text });
        }
    });

    socket.on('start-mic', () => {
        const room = rooms.find(r => r.id === socket.currentRoom);
        if (room && socket.role === "OWNER" && !room.broadcaster) {
            room.broadcaster = socket.id;
            socket.to(socket.currentRoom).emit('mic-started');
        }
    });

    socket.on('stop-mic', () => {
        const room = rooms.find(r => r.id === socket.currentRoom);
        if (room && room.broadcaster === socket.id) {
            room.broadcaster = null;
            io.to(socket.currentRoom).emit('mic-stopped');
        }
    });

    socket.on('audio-data', (data) => {
        const room = rooms.find(r => r.id === socket.currentRoom);
        if (room && room.broadcaster === socket.id) {
            socket.to(socket.currentRoom).emit('audio-stream', data);
        }
    });

    socket.on('room-action', (data) => {
        if (socket.role !== "OWNER") return;
        const room = rooms.find(r => r.id === socket.currentRoom);
        if (!room) return;

        if (data.action === "clear") {
            io.to(socket.currentRoom).emit('clear-chat');
            io.to(socket.currentRoom).emit('sys-message', "🧹 تم مسح الحائط البرقي بواسطة إدارة الغرفة");
        } else if (data.action === "rename") {
            room.name = data.value;
            io.to(socket.currentRoom).emit('room-renamed', data.value);
            io.emit('update-rooms', rooms.map(r => ({ id: r.id, name: r.name, activeUsers: r.activeUsers })));
        } else if (data.action === "bg") {
            room.bg = data.value;
            io.to(socket.currentRoom).emit('room-bg-changed', data.value);
        } else if (data.action === "mod") {
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket && targetSocket.currentRoom === socket.currentRoom) {
                targetSocket.role = "MOD";
                if(!room.mods.includes(targetSocket.username)) room.mods.push(targetSocket.username);
                targetSocket.emit('role-assigned', { role: "MOD", roomName: room.name, bg: room.bg });
                io.to(socket.currentRoom).emit('sys-message', `👮 تم ترقية ${targetSocket.username} إلى مشرف الغرفة`);
                updateRoomUsers(socket.currentRoom);
            }
        }
    });

    socket.on('admin-update-rooms', (newRooms) => {
        if (socket.username === SUPER_ADMIN && socket.role === "OWNER") {
            rooms = newRooms.map(nr => {
                const old = rooms.find(o => o.id === nr.id);
                return {
                    id: nr.id,
                    name: nr.name,
                    pass: nr.pass || (old ? old.pass : "1234"),
                    bg: old ? old.bg : "",
                    mods: old ? old.mods : [],
                    activeUsers: old ? old.activeUsers : 0,
                    broadcaster: old ? old.broadcaster : null
                };
            });
            io.emit('update-rooms', rooms.map(r => ({ id: r.id, name: r.name, activeUsers: r.activeUsers })));
        }
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            const roomId = socket.currentRoom;
            const room = rooms.find(r => r.id === roomId);
            if (room) {
                room.activeUsers = Math.max(0, room.activeUsers - 1);
                if (room.broadcaster === socket.id) {
                    room.broadcaster = null;
                    io.to(roomId).emit('mic-stopped');
                }
                io.emit('update-rooms', rooms.map(r => ({ id: r.id, name: r.name, activeUsers: r.activeUsers })));
            }
            if (socket.username) {
                let prefix = socket.role === "OWNER" ? "👑 المالك " : (socket.role === "MOD" ? "👮 المشرف " : "👤 ");
                io.to(roomId).emit('sys-message', `${prefix} ${socket.username} غادر الغرفة`);
            }
            updateRoomUsers(roomId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});
