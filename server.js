const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve the landing application layout
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let voiceQueue = [];
let activeMatches = {}; // Tracks socket.id -> currentRoom

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_queue', () => {
        // Clean out any stale queue items or active rooms
        cleanUserSession(socket);

        if (voiceQueue.length > 0) {
            const partnerSocketId = voiceQueue.shift();
            
            // Check if partner is still validly online
            if (io.sockets.sockets.has(partnerSocketId)) {
                const roomId = `room_${socket.id}_${partnerSocketId}`;

                socket.join(roomId);
                io.sockets.sockets.get(partnerSocketId).join(roomId);

                activeMatches[socket.id] = roomId;
                activeMatches[partnerSocketId] = roomId;

                // User A orchestrates WebRTC offer initialization
                socket.emit('match_found', { roomId, initiateCall: true, partnerId: partnerSocketId });
                // User B accepts WebRTC call setup
                io.to(partnerSocketId).emit('match_found', { roomId, initiateCall: false, partnerId: socket.id });

                console.log(`Matched Room created: ${roomId}`);
            } else {
                // Partner left unexpectedly, put current user back up top
                voiceQueue.push(socket.id);
                socket.emit('waiting', { status: 'Searching for a stranger...' });
            }
        } else {
            voiceQueue.push(socket.id);
            socket.emit('waiting', { status: 'Searching for a stranger...' });
        }
    });

    // Handle Text Chat Messages 
    socket.on('text_message', (data) => {
        socket.to(data.room).emit('text_message', { message: data.message });
    });

    // Pass WebRTC Offers, Answers, and Candidates between peers
    socket.on('webrtc_signal', (data) => {
        io.to(data.to).emit('webrtc_signal', {
            from: socket.id,
            signal: data.signal
        });
    });

    // Handle manual disconnects or skip request
    socket.on('leave_room', () => {
        cleanUserSession(socket);
    });

    socket.on('disconnect', () => {
        cleanUserSession(socket);
        console.log(`User disconnected: ${socket.id}`);
    });
});

function cleanUserSession(socket) {
    // Remove from the matching queue if present
    voiceQueue = voiceQueue.filter(id => id !== socket.id);

    // Tear down active session if matched
    const roomId = activeMatches[socket.id];
    if (roomId) {
        socket.to(roomId).emit('partner_disconnected');
        
        // Remove both entries from the active tracker map
        const roomPeers = roomId.replace('room_', '').split('_');
        roomPeers.forEach(peerId => {
            delete activeMatches[peerId];
            const peerSocket = io.sockets.sockets.get(peerId);
            if (peerSocket) peerSocket.leave(roomId);
        });
    }
}

server.listen(PORT, () => {
    console.log(`AirTalk Server running seamlessly on http://localhost:${PORT}`);
});
