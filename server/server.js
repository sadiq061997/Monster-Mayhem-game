//google drive video link : https://drive.google.com/file/d/1-jq72tGjuYP1JDo2XSmtMFFLFDYHHnTJ/view?usp=sharing

const express = require("express"); //IMPORT express framework and use to create the web server
const bodyParser = require("body-parser"); //to handle url-encoded data from the client requests
const http = require("http"); //http module to set up the server alongside express
const { Server } = require("socket.io"); //server real-time communication b/w the client and server
const path = require("path"); //handle path file
const async = require("async"); // manage queue for processing player action sequently
const fs = require("fs").promises; // promise to read and write stats to a file

// Define server port
const PORT = 3000;

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Set up Socket.IO with permissive CORS for development
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

// Middleware to parse URL-encoded bodies and serve static files
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../client")));

// Root route for basic server greeting send welcome response
app.get("/", (req, res) => {
    console.log("Yay, a visitor!");
    console.log(req);
    res.send("Welcome to web server!");
});

// Route to display Monster Mayhem game stats total games played
app.get("/MONSTER-MAYHEM", (req, res) => {
    res.send("<h1>Monster Mayhem</h1><p>Games Played: <span id=total-games>0</span></p> ");
});

// Serve index.html for /html route
app.get("/html", (req, res) => {
    res.sendFile("index.html", { root: path.join(__dirname, "../client") });
});

// Catch-all route to serve index.html for client-side routing
app.get("*", (req, res) => {
    res.sendFile("index.html", { root: path.join(__dirname, "../client") });
});

// In-memory storage for games and global stats store active games
let games = {};
let globalStats = { totalGames: 0, playerStats: {} }; // total games per player win/loose records.

// Load stats from stats.json file on server start 
async function loadStats() { 
    try {
        const data = await fs.readFile(path.join(__dirname, "stats.json"), "utf8");
        globalStats = JSON.parse(data);
    } catch (err) {
        console.log("No stats file found, starting fresh");
    }
}

// Save stats to stats.json file
async function saveStats() {
    try {
        await fs.writeFile(path.join(__dirname, "stats.json"), JSON.stringify(globalStats, null, 2));
    } catch (err) {
        console.error("Failed to save stats:", err);
    }
}
// Initialize stats on server start
loadStats();

// Async queue to process player actions sequentially (prevents race conditions)
const actionQueue = async.queue((task, callback) => {
    const { gameId, playerId, action, socket } = task;
    const game = games[gameId];
    if (!game || game.gameState.currentTurn !== playerId) {
        socket.emit("error", "Not your turn or invalid game");
        return callback();
    }

    //This handles placing a monster, ensuring it’s on the player’s edge (row 0 or 9)
    if (action.type === "placeMonster") {
        // Ensure monsters are placed on the player's edge (row 0 for P1, row 9 for P2)
        const isPlayer1 = game.players[0].id === playerId;
        if ((isPlayer1 && action.position.row !== 0) || (!isPlayer1 && action.position.row !== 9)) {
            socket.emit("error", "Monsters must be placed on your edge (top/bottom row)");
            return callback();
        }
        // Create a unique monster ID and add to game state
        const monsterId = `${playerId}_${Date.now()}`;
        game.gameState.monsters[monsterId] = {
            type: action.monsterType,
            position: action.position,
            playerId,
        };
        resolveMonsterInteractions(game);

        //This validates and processes monster movement, checking for valid orthogonal or diagonal moves up to 2 cells
    } else if (action.type === "moveMonster") {
        // Validate monster ownership and move
        const monster = game.gameState.monsters[action.monsterId];
        if (!monster || monster.playerId !== playerId) {
            socket.emit("error", "Invalid monster");
            return callback();
        }
        // Check if move is valid (orthogonal or diagonal, up to 2 cells)
        const dx = Math.abs(action.position.row - monster.position.row);
        const dy = Math.abs(action.position.col - monster.position.col);
        if ((dx === 0 && dy > 0) || (dy === 0 && dx > 0) || (dx <= 2 && dy <= 2 && dx > 0 && dy > 0)) {
    
            
            // Update monster position
            monster.position = action.position;
            resolveMonsterInteractions(game);
            console.log(`Moved monster ${action.monsterId} to (${action.position.row}, ${action.position.col}). Checking for fights...`);
        } else {
            socket.emit("error", "Invalid move");
            return callback();
        }
        //This advances the turn to the next player based on monster counts
    } else if (action.type === "endTurn") {
        // Advance to the next player's turn
        updateTurnOrder(gameId);
    }

    // Check if the game has ended and broadcast updated state
    checkGameEnd(gameId);
    broadcastGameState(gameId);
    callback();
}, 1); // Process one action at a time

// Handle Socket.IO connections for client
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Handle player joining a game limiting to 2 players and initializing stats
    socket.on("joinGame", (gameId) => {
        if (!gameId) {
            socket.emit("error", "Game ID required");
            return;
        }
        // Initialize new game if it doesn't exist
        if (!games[gameId]) {
            games[gameId] = {
                players: [],
                gameState: { monsters: {}, currentTurn: null },
                monsterRemovals: {},
                totalGames: 0,
            };
        }
        const game = games[gameId];
        // Limit to 2 players per game
        if (game.players.length >= 2) {
            socket.emit("error", "Game is full");
            return;
        }
        // Add player to game and initialize their stats
        game.players.push({ id: socket.id, active: false });
        game.monsterRemovals[socket.id] = 0;
        if (!globalStats.playerStats[socket.id]) {
            globalStats.playerStats[socket.id] = { wins: 0, losses: 0 };
        }
        updateTurnOrder(gameId);
        socket.join(gameId);
        socket.emit("gameJoined", { gameId, gameState: game.gameState, players: game.players });
        socket.emit("updateStats", {
            stats: globalStats.playerStats[socket.id],
            totalGames: globalStats.totalGames,
        });
        broadcastGameState(gameId);
    });

    // Handle player actions (place/move/end turn)
    socket.on("playerAction", ({ gameId, action }) => {
        actionQueue.push({ gameId, playerId: socket.id, action, socket });
    });

    // Handle player disconnection 
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        for (const gameId in games) {
            const game = games[gameId];
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                // Remove player and their monsters
                game.players.splice(playerIndex, 1);
                delete game.monsterRemovals[socket.id];
                Object.keys(game.gameState.monsters).forEach(monsterId => {
                    if (game.gameState.monsters[monsterId].playerId === socket.id) {
                        delete game.gameState.monsters[monsterId];
                    }
                });
                // Clean up empty games or update remaining players
                if (game.players.length === 0) {
                    delete games[gameId];
                } else {
                    updateTurnOrder(gameId);
                    broadcastGameState(gameId);
                }
            }
        }
    });
});

// send Broadcast game state to all players in a game
function broadcastGameState(gameId) {
    const game = games[gameId];
    if (!game) return;
    io.to(gameId).emit("updateGameState", { gameState: game.gameState, players: game.players });
    io.to(gameId).emit("updateStats", {
        stats: globalStats.playerStats,
        totalGames: globalStats.totalGames,
    });
}

// Update turn order based on player with fewest monsters
function updateTurnOrder(gameId) {
    const game = games[gameId];
    if (!game) return;
    const monsterCounts = {};
    game.players.forEach(p => {
        monsterCounts[p.id] = Object.values(game.gameState.monsters).filter(m => m.playerId === p.id).length;
    });
    const minMonsters = Math.min(...Object.values(monsterCounts));
    const eligiblePlayers = game.players.filter(p => game.monsterRemovals[p.id] < 10 && monsterCounts[p.id] === minMonsters);
    if (eligiblePlayers.length === 0) return;
    const nextPlayer = eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)];
    game.gameState.currentTurn = nextPlayer.id;
    game.players.forEach(p => p.active = p.id === nextPlayer.id);
}

// Resolve monster interactions based on rock-paper-scissors rules
function resolveMonsterInteractions(game) {
    const positions = {};
    // Group monsters by position
    for (const [id, monster] of Object.entries(game.gameState.monsters)) {
        const pos = `${monster.position.row},${monster.position.col}`;
        if (!positions[pos]) positions[pos] = [];
        positions[pos].push({ id, type: monster.type, playerId: monster.playerId });
    }
    // Resolve conflicts at each position
    for (const pos in positions) {
        const monsters = positions[pos];
        if (monsters.length > 1) {
            if (monsters.length === 2) {
                const [m1, m2] = monsters;
                // Same type: both monsters are removed
                if (m1.type === m2.type) {
                    delete game.gameState.monsters[m1.id];
                    delete game.gameState.monsters[m2.id];
                    game.monsterRemovals[m1.playerId] = (game.monsterRemovals[m1.playerId] || 0) + 1;
                    game.monsterRemovals[m2.playerId] = (game.monsterRemovals[m2.playerId] || 0) + 1;
                } else if (m1.type === "vampire" && m2.type === "werewolf") {
                    delete game.gameState.monsters[m2.id];
                    game.monsterRemovals[m2.playerId] = (game.monsterRemovals[m2.playerId] || 0) + 1;
                } else if (m1.type === "werewolf" && m2.type === "ghost") {
                    delete game.gameState.monsters[m2.id];
                    game.monsterRemovals[m2.playerId] = (game.monsterRemovals[m2.playerId] || 0) + 1;
                } else if (m1.type === "ghost" && m2.type === "vampire") {
                    delete game.gameState.monsters[m2.id];
                    game.monsterRemovals[m2.playerId] = (game.monsterRemovals[m2.playerId] || 0) + 1;
                } else {
                    // Reverse checks for m2 beating m1
                    if (m2.type === "vampire" && m1.type === "werewolf") {
                        delete game.gameState.monsters[m1.id];
                        game.monsterRemovals[m1.playerId] = (game.monsterRemovals[m1.playerId] || 0) + 1;
                    } else if (m2.type === "werewolf" && m1.type === "ghost") {
                        delete game.gameState.monsters[m1.id];
                        game.monsterRemovals[m1.playerId] = (game.monsterRemovals[m1.playerId] || 0) + 1;
                    } else if (m2.type === "ghost" && m1.type === "vampire") {
                        delete game.gameState.monsters[m1.id];
                        game.monsterRemovals[m1.playerId] = (game.monsterRemovals[m1.playerId] || 0) + 1;
                    }
                }
            } else {
                // More than two monsters: all are removed
                monsters.forEach(m => {
                    delete game.gameState.monsters[m.id];
                    game.monsterRemovals[m.playerId] = (game.monsterRemovals[m.playerId] || 0) + 1;
                    console.log(`${m.type} at ${pos} removed due to overcrowding. ${m.playerId} removals: ${game.monsterRemovals[m.playerId]}`);
                });
            }
        }
    }
}

// Check if the game has ended and update stats
function checkGameEnd(gameId) {
    const game = games[gameId];
    if (!game) return;
    // End game if only one player has fewer than 10 monster removals
    const activePlayers = game.players.filter(p => game.monsterRemovals[p.id] < 10);
    if (activePlayers.length <= 1) {
        globalStats.totalGames += 1;
        game.players.forEach(p => {
            if (activePlayers.length === 1 && p.id === activePlayers[0].id) {
                globalStats.playerStats[p.id].wins += 1;
            } else {
                globalStats.playerStats[p.id].losses += 1;
            }
        });
        io.to(gameId).emit("gameEnded", { winner: activePlayers.length === 1 ? activePlayers[0].id : null });
        delete games[gameId];
        saveStats();
    }
}

// Start the server and logs the port number
server.listen(PORT, () => {
    console.log(`Listening on port: ${PORT}`);
});