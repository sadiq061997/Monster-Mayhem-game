// Wait for DOM to load before initializing game logic
document.addEventListener("DOMContentLoaded", () => {
    // set up  Socket.IO with reconnection settings
    const socket = io('http://localhost:3000', {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
    });

    // Cache DOM elements for performance and readability
    const grid = document.getElementById("grid"); // cache DOM elements for the grid , buttons, input and stats display
    const message = document.getElementById("message");
    const joinGameBtn = document.getElementById("join-game");
    const gameIdInput = document.getElementById("game-id");
    const monsterTypeSelect = document.getElementById("monster-type");
    const endTurnBtn = document.getElementById("end-turn");
    const moveControls = document.getElementById("move-controls");
    const moveUpBtn = document.getElementById("move-up");
    const moveDownBtn = document.getElementById("move-down");
    const moveLeftBtn = document.getElementById("move-left");
    const moveRightBtn = document.getElementById("move-right");
    const moveCoordinatesInput = document.getElementById("move-coordinates");
    const moveToBtn = document.getElementById("move-to");
    const totalGamesSpan = document.getElementById("total-games");
    const winsSpan = document.getElementById("wins");
    const lossesSpan = document.getElementById("losses"); 
// Initialize game state variables
let gameId = null; // Tracks current game ID
let playerId = null; // Tracks current player's Socket.IO ID
let selectedMonsterId = null; // Tracks selected monster for movement
let gameState = { monsters: {} }; // Stores game state (monsters and their positions)
let players = []; // Tracks players and their active status

// Handle successful connection to server
socket.on("connect", () => {
    console.log("Connected to server, playerId:", socket.id);
    playerId = socket.id;
    message.textContent = gameId ? "Reconnected! Your turn!" : "Connected to server!";
});

// Handle connection errors
socket.on("connect_error", (error) => {
    console.error("Connection error:", error);
    message.textContent = "Server lost! Attempting to reconnect...";
});

// Handle successful reconnection
socket.on("reconnect", (attempt) => {
    console.log("Reconnected to server after", attempt, "attempts");
    if (gameId) {
        socket.emit("joinGame", gameId); // Rejoin game if already in one
    }
});

// Handle failed reconnection attempts
socket.on("reconnect_failed", () => { //this notifies if reconnection fails
    console.error("Reconnection failed");
    message.textContent = "Failed to reconnect to server. Please refresh the page.";
});

// Initialize 10x10 game grid with click handler
function initGrid() {
    grid.innerHTML = ""; // Clear existing grid
    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const cell = document.createElement("div");
            cell.classList.add("cell"); // Add cell styling
            cell.dataset.row = row; // Store row for event handling
            cell.dataset.col = col; // Store column for event handling
            cell.addEventListener("click", () => handleCellClick(row, col)); // Add Álvaro
            grid.appendChild(cell);
        }
    }
    console.log("Grid initialized");
}
// Handle cell clicks for monster placement or movement
function handleCellClick(row, col) { 
    console.log("Cell clicked:", { row, col, gameId, playerId, activePlayer: players.find(p => p.active)?.id });
    if (!gameId || !players.find(p => p.id === playerId)) {
        message.textContent = "Join a game first!";
        console.log("Cannot place monster: Game not joined");
        return;
    }
    if (players.find(p => p.active)?.id !== playerId) {
        message.textContent = "Not your turn!";
        console.log("Cannot place monster: Not your turn");
        return;
    }
    const playerMonster = Object.values(gameState.monsters).find(m => m.playerId === playerId);
    if (!playerMonster) {
        // Monster placement logic (initial placement on player's edge)
        const isPlayer1 = players[0]?.id === playerId;
        if ((isPlayer1 && row !== 0) || (!isPlayer1 && row !== 9)) {
            message.textContent = `Place your monster on your edge (row ${isPlayer1 ? 0 : 9})!`;
            console.log("Cannot place monster: Invalid row for player");
            return;
        }
        console.log("Emitting placeMonster action:", { monsterType: monsterTypeSelect.value, row, col });
        socket.emit("playerAction", {
            gameId,
            action: {
                type: "placeMonster",
                monsterType: monsterTypeSelect.value,
                position: { row, col },
            },
        });
    } else {
        // Monster movement logic
        selectedMonsterId = Object.keys(gameState.monsters).find(key => gameState.monsters[key] === playerMonster);
        console.log("Auto-selected monster for movement:", { selectedMonsterId, position: playerMonster.position });
        console.log("Emitting moveMonster action:", { monsterId: selectedMonsterId, row, col });
        socket.emit("playerAction", {
            gameId,
            action: {
                type: "moveMonster",
                monsterId: selectedMonsterId,
                position: { row, col },
            },
        });
        selectedMonsterId = null;
        message.textContent = "Your turn!";
    }
}

// Handle join/create game button click
joinGameBtn.addEventListener("click", () => {
    gameId = gameIdInput.value.trim();
    if (!gameId) {
        message.textContent = "Please enter a game ID";
        console.log("Join game failed: No game ID");
        return;
    }
    console.log("Joining game with ID:", gameId);
    socket.emit("joinGame", gameId);
});

// Handle end turn button click
endTurnBtn.addEventListener("click", () => {
    console.log("End turn clicked, emitting endTurn action");
    socket.emit("playerAction", {
        gameId,
        action: { type: "endTurn" },
    });
});

// Directional movement handlers
moveUpBtn.addEventListener("click", () => moveMonster(-1, 0));
moveDownBtn.addEventListener("click", () => moveMonster(1, 0));
moveLeftBtn.addEventListener("click", () => moveMonster(0, -1));
moveRightBtn.addEventListener("click", () => moveMonster(0, 1));

// Handle coordinate-based movement
moveToBtn.addEventListener("click", () => {
    const coords = moveCoordinatesInput.value.trim();
    const [row, col] = coords.split(",").map(Number);
    if (isNaN(row) || isNaN(col) || row < 0 || row > 9 || col < 0 || col > 9) {
        message.textContent = "Invalid coordinates! Enter row,col (e.g., 8,1)";
        return;
    }
    moveMonsterTo(row, col);
});

// Move monster by relative coordinates (directional)
function moveMonster(dRow, dCol) {
    if (!gameId || !players.find(p => p.id === playerId) || players.find(p => p.active)?.id !== playerId) {
        console.log("Cannot move: Invalid game state or not your turn");
        return;
    }
    const monster = Object.values(gameState.monsters).find(m => m.playerId === playerId);
    if (!monster) {
        message.textContent = "No monster to move!";
        console.log("Cannot move: No monster found");
        return;
    }
    const newRow = monster.position.row + dRow;
    const newCol = monster.position.col + dCol;
    if (newRow >= 0 && newRow < 10 && newCol >= 0 && newCol < 10) {

     
        const monsterId = Object.keys(gameState.monsters).find(key => gameState.monsters[key] === monster);
        console.log("Emitting moveMonster action:", { monsterId, row: newRow, col: newCol });
        socket.emit("playerAction", {
            gameId,
            action: {
                type: "moveMonster",
                monsterId,
                position: { row: newRow, col: newCol },
            },
        });
        message.textContent = "Your turn!";
    } else {
        message.textContent = "Move out of bounds!";
        console.log("Cannot move: Out of bounds", { newRow, newCol });
    }
}

// Move monster to specific coordinates
function moveMonsterTo(row, col) {
    if (!gameId || !players.find(p => p.id === playerId) || players.find(p => p.active)?.id !== playerId) {
        console.log("Cannot move: Invalid game state or not your turn");
        return;
    }
    const monster = Object.values(gameState.monsters).find(m => m.playerId === playerId);
    if (!monster) {
        message.textContent = "No monster to move!";
        console.log("Cannot move: No monster found");
        return;
    }

    if (row < 0 || row > 9 || col < 0 || col > 9) {
        message.textContent = "Invalid coordinates! Enter row,col (e.g., 8,1)";
        return;
    }
  
    const monsterId = Object.keys(gameState.monsters).find(key => gameState.monsters[key] === monster);
    console.log("Emitting moveMonster action:", { monsterId, row, col });
    socket.emit("playerAction", {
        gameId,
        action: {
            type: "moveMonster",
            monsterId,
            position: { row, col },
        },
    });
    message.textContent = "Your turn!";
}

    // Helper function to check if a cell is occupied by an opponent
    function isCellOccupiedByOpponent(row, col) {
        return Object.values(gameState.monsters).some(m => m.playerId !== playerId && m.position.row === row && m.position.col === col);
    }

// Handle game join event
socket.on("gameJoined", ({ gameId: id, gameState: initialState, players: updatedPlayers }) => {
    gameId = id;
    players = updatedPlayers;
    gameState = { ...initialState };
    joinGameBtn.classList.add("hidden"); // Hide join button
    gameIdInput.classList.add("hidden"); // Hide game ID input
    updateGameState();
    renderGrid();
    console.log("Game joined:", { gameId, players, gameState });
});




// Update game state and UI
socket.on("updateGameState", ({ gameState: updatedState, players: updatedPlayers }) => {
    players = updatedPlayers;
    gameState = { ...updatedState };
    renderGrid();
    updateGameState();
    suggestMoves();
    console.log("Game state updated:", { gameState, players });
});

// Update player stats
socket.on("updateStats", ({ stats, totalGames }) => {
    winsSpan.textContent = stats[playerId]?.wins || 0;
    lossesSpan.textContent = stats[playerId]?.losses || 0;
    totalGamesSpan.textContent = totalGames;
    console.log("Stats updated:", { stats: stats[playerId], totalGames});
    if (!stats[playerId]){
        console.warn("No stats found for playerId:", playerId)
    }
});

// Handle server error messages
socket.on("error", (msg) => {
    message.textContent = msg;
    console.log("Server error:", msg);
});

// Handle game end event
socket.on("gameEnded", ({ winner }) => {
    message.textContent = winner === playerId ? "You won!" : "Game over! You lost.";
    joinGameBtn.classList.remove("hidden");
    gameIdInput.classList.remove("hidden");
    endTurnBtn.classList.add("hidden");
    moveControls.classList.add("hidden");
    gameId = null;
    gameState = { monsters: {} };
    renderGrid();
    console.log("Game ended, winner:", winner);
});

// === Monster type to Emoji mapping ===
const monsterEmojis = {
    vampire: '🧛',
    werewolf: '🐺',
    ghost: '👻'
};

// Render monsters on the grid
function renderGrid() {
    initGrid(); // Reset grid
    for (let [monsterId, monster] of Object.entries(gameState.monsters)) {
        const cell = grid.querySelector(
            `.cell[data-row="${monster.position.row}"][data-col="${monster.position.col}"]`
        );
        if (cell) {
            cell.classList.remove("vampire", "werewolf", "ghost"); // Clear previous classes
            cell.classList.add(monster.type); // Add monster type class
            cell.dataset.monsterId = monsterId; // Store monster ID
            cell.textContent = monsterEmojis[monster.type] || monster.type;
            console.log("Rendered monster:", { monsterId, type: monster.type, position: monster.position, cellContent: cell.textContent });
        } else {
            console.log("Cell not found for monster:", { monsterId, position: monster.position });
        }
    }
}

// Update UI based on game state
function updateGameState() {
    const me = players.find(p => p.id === playerId);
    if (!me) return;
    const activePlayer = players.find(p => p.active);
    if (activePlayer) {
        message.textContent = activePlayer.id === playerId ? "Your turn!" : "Waiting for opponent...";
        endTurnBtn.classList.toggle("hidden", activePlayer.id !== playerId);
        const hasMonster = !!Object.values(gameState.monsters).find(m => m.playerId === playerId);
        moveControls.classList.toggle("hidden", activePlayer.id !== playerId || !hasMonster);
        if (activePlayer.id === playerId && hasMonster) {
            const monster = Object.values(gameState.monsters).find(m => m.playerId === playerId);
            selectedMonsterId = Object.keys(gameState.monsters).find(key => gameState.monsters[key] === monster);
            console.log("Auto-selected monster on turn:", { selectedMonsterId, position: monster.position });
        }
    } else {
        message.textContent = players[0].id === playerId ? "Start the game!" : "Waiting for the first player...";
        endTurnBtn.classList.toggle("hidden", players[0].id !== playerId);
        moveControls.classList.add("hidden");
    }
    console.log("Game state updated, active player:", activePlayer?.id);
}


// suggesting rows / cols
function suggestMoves() {
    const monster = Object.values(gameState.monsters).find(m => m.playerId === playerId);
    if (!monster || players.find(p => p.active)?.id !== playerId) return;
    const validMoves = [];
    for (let dRow = -2; dRow <= 2; dRow++) {
        for (let dCol = -2; dCol <= 2; dCol++) {
            if (dRow === 0 && dCol === 0) continue;
            const newRow = monster.position.row + dRow;
            const newCol = monster.position.col + dCol;
            if (newRow >= 0 && newRow < 10 && newCol >= 0 && newCol < 10 ) {
                validMoves.push(`(${newRow},${newCol})`);
            }
        }
    }
    if (validMoves.length > 0) {
        message.textContent += ` Suggested moves: ${validMoves.join(", ")}`;
    }
}

// Initialize grid on page load
initGrid();
});