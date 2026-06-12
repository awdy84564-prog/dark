const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});

app.use(express.static('public'));
app.use(express.json({limit: '5mb'}));

let users = {};
let messages = [];
let bannedIps = new Set();
let imageCount = {}; // عداد الصور اليومي

// رتب ويفو 2021 الاصلية
const RANKS = {
  0: { name: 'زائر', color: '#9e9e9e', icon: '👤', canImage: false },
  1: { name: 'عضو', color: '#4caf50', icon: '⭐', canImage: false },
  2: { name: 'عضو مميز', color: '#2196f3', icon: '💎', canImage: true },
  3: { name: 'مشرف', color: '#ff9800', icon: '🛡️', canImage: true },
  4: { name: 'ادمن', color: '#f44336', icon: '⚡', canImage: true },
  5: { name: 'المالك', color: '#FFD700', icon: '👑', canImage: true, glow: true }
};

// كلمات السر للرتب
const RANK_PASSWORDS = {
  'dark2025': 5, // المالك
  'admin2025': 4, // ادمن
  'mod2025': 3, // مشرف
  'vip2025': 2 // مميز
};

// تصفير عداد الصور كل 24 ساعة
setInterval(() => {
  imageCount = {};
  io.emit('system', 'تم تصفير عداد الصور اليومي');
}, 24 * 60 * 60 * 1000);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  if(bannedIps.has(ip)) {
    socket.emit('banned');
    socket.disconnect();
    return;
  }

  socket.on('join', ({username, password}) => {
    let rank = 0;
    if(password && RANK_PASSWORDS[password]) {
      rank = RANK_PASSWORDS[password];
    } else if(username === 'DARK VIP ROOT') {
      rank = 5; // المالك الاساسي
    } else if(Object.values(users).length === 0) {
      rank = 5; // اول شخص يدخل يصير مالك
    } else {
      rank = 1; // عضو عادي
    }

    users[socket.id] = {
      id: socket.id,
      username,
      rank,
      ip,
      muted: false,
      lastMessage: 0,
      joinTime: Date.now()
    };

    socket.emit('init', {
      user: users[socket.id],
      messages: messages.slice(-50),
      users: Object.values(users)
    });

    socket.broadcast.emit('userJoined', users[socket.id]);
    io.emit('updateUsers', Object.values(users));
  });

  // نظام الشات مع فلود
  socket.on('message', (text) => {
    const user = users[socket.id];
    if(!user || user.muted) return;

    // حماية فلود: رسالة كل 1.5 ثانية
    if(Date.now() - user.lastMessage < 1500) {
      socket.emit('system', 'لا ترسل بسرعة! انتظر ثانية');
      return;
    }
    user.lastMessage = Date.now();

    const msg = {
      id: Date.now(),
      text: text.substring(0, 300),
      user: { username: user.username, rank: user.rank },
      time: new Date().toLocaleTimeString('ar-EG')
    };

    messages.push(msg);
    if(messages.length > 100) messages.shift();
    io.emit('message', msg);
  });

  // ارسال صور - فقط للرتب
  socket.on('sendImage', (base64) => {
    const user = users[socket.id];
    if(!user ||!RANKS[user.rank].canImage) {
      socket.emit('system', 'فقط الرتب ترسل صور');
      return;
    }

    // حد 3 صور باليوم
    if(!imageCount[socket.id]) imageCount[socket.id] = 0;
    if(imageCount[socket.id] >= 3) {
      socket.emit('system', 'وصلت للحد اليومي: 3 صور فقط');
      return;
    }

    imageCount[socket.id]++;

    const msg = {
      id: Date.now(),
      image: base64,
      user: { username: user.username, rank: user.rank },
      time: new Date().toLocaleTimeString('ar-EG')
    };

    messages.push(msg);
    io.emit('message', msg);
    socket.emit('system', `باقي لك ${3 - imageCount[socket.id]} صور اليوم`);
  });

  // المايك - نظام ويفو: 6 مايكات
  socket.on('micRequest', (micNum) => {
    const user = users[socket.id];
    if(!user) return;
    io.emit('micUpdate', { userId: socket.id, username: user.username, mic: micNum, rank: user.rank });
  });

  socket.on('leaveMic', () => {
    io.emit('micLeave', socket.id);
  });

  // طرد + باند - للمشرف وفوق
  socket.on('kick', (targetId) => {
    const user = users[socket.id];
    const target = users[targetId];
    if(!user || user.rank < 3 ||!target) return;
    if(target.rank >= user.rank) {
      socket.emit('system', 'ما تقدر تطرد رتبة اعلى او مساوية');
      return;
    }
    io.to(targetId).emit('kicked');
    io.sockets.sockets.get(targetId)?.disconnect();
  });

  socket.on('ban', (targetId) => {
    const user = users[socket.id];
    const target = users[targetId];
    if(!user || user.rank < 4 ||!target) return;
    if(target.rank >= user.rank) {
      socket.emit('system', 'ما تقدر تبند رتبة اعلى او مساوية');
      return;
    }
    bannedIps.add(target.ip);
    io.to(targetId).emit('banned');
    io.sockets.sockets.get(targetId)?.disconnect();
  });

  // كتم
  socket.on('mute', (targetId) => {
    const user = users[socket.id];
    const target = users[targetId];
    if(!user || user.rank < 3 ||!target) return;
    target.muted =!target.muted;
    io.emit('system', `${user.username} ${target.muted? 'كتم' : 'فك كتم'} ${target.username}`);
    io.emit('updateUsers', Object.values(users));
  });

  socket.on('disconnect', () => {
    if(users[socket.id]) {
      io.emit('userLeft', users[socket.id]);
      delete users[socket.id];
      io.emit('updateUsers', Object.values(users));
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`WEVO 2021 running on ${PORT}`));
