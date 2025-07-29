/* Basic styling for the Sniper Hold'em site. This file mirrors the provided
   "style (1).css" but uses a conventional filename. */

body {
    /* A poker-themed background image for the lobby.  The image
       poker_bg.png is included in the repository and provides a
       green felt table with chips.  Use a fixed background so it
       fills the viewport on all screen sizes. */
    margin: 0;
    font-family: Arial, Helvetica, sans-serif;
    background: #0a561d url('poker_bg.png') no-repeat center center fixed;
    background-size: cover;
    color: #fff;
    min-height: 100vh;
}

.screen {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    text-align: center;
}

h1 {
    margin-top: 0;
    font-size: 2.2rem;
}

.description {
    margin-bottom: 20px;
    font-size: 0.9rem;
    /* Lighten the description text for better contrast on dark backgrounds */
    color: #ddd;
}

.lobby-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 15px;
}

.join-area {
    display: flex;
    gap: 5px;
}

input[type="text"], input[type="number"] {
    padding: 8px;
    font-size: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    /* Make inputs stand out on the dark lobby overlay */
    background: rgba(255, 255, 255, 0.9);
    color: #333;
}

button {
    padding: 8px 14px;
    font-size: 1rem;
    border: none;
    border-radius: 4px;
    background: #007bff;
    color: white;
    cursor: pointer;
    transition: background 0.2s ease;
}

button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

button:not(:disabled):hover {
    background: #0056b3;
}

/* When the actual game area is visible, revert text to dark for
   better contrast on the default white card backgrounds. */
#game {
    color: #333;
}

.status {
    margin-top: 15px;
    /* Use a warmer red for the status message against the green felt */
    color: #ff6347;
}

/* Lobby overlay container to improve readability against the busy poker
   table background.  It wraps the lobby controls and instructions. */
.lobby-overlay {
    background: rgba(0, 0, 0, 0.6);
    padding: 25px;
    border-radius: 8px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    max-width: 800px;
    margin: 40px auto;
}

/* Instructions section styling */
.instructions {
    text-align: left;
    margin-top: 20px;
    color: #eee;
    font-size: 0.85rem;
    line-height: 1.4;
}

.instructions h3 {
    margin-top: 15px;
    margin-bottom: 8px;
    color: #fff;
    font-size: 1.1rem;
}

.instructions ul {
    margin-left: 20px;
    margin-bottom: 10px;
    padding-left: 20px;
}

.instructions li {
    margin-bottom: 5px;
}

#statusBar {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 15px;
    font-weight: bold;
}

/* Hide old player/comm/hole areas since the new table UI will replace them */
#playersArea,
#communityArea,
#holeArea {
    display: none;
}

/* Container for the poker table that keeps the oval centred and responsive */
#tableWrapper {
    position: relative;
    max-width: 800px;
    width: 100%;
    height: 500px;
    margin: 0 auto;
    /* Add some margin below to separate from controls */
    margin-bottom: 20px;
}

/* The oval poker table graphic */
#pokerTable {
    position: relative;
    width: 100%;
    height: 100%;
    background: radial-gradient(ellipse at center, #115c2f 0%, #0a3e1a 100%);
    border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
    border: 8px solid #4b2e17;
    overflow: hidden;
}

/* Community cards area positioned in the centre of the table */
.community-cards {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    gap: 6px;
    z-index: 1;
}
.community-card {
    width: 50px;
    height: 70px;
    border: 1px solid #999;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    font-weight: bold;
    background: #fff;
    color: #333;
}

/* Seat representing a player around the table */
.player-seat {
    position: absolute;
    width: 90px;
    text-align: center;
    transform: translate(-50%, -50%);
    z-index: 2;
    color: #fff;
    font-size: 0.8rem;
}
/* highlight active player's seat */
.player-seat.current-turn {
    box-shadow: 0 0 0 3px #007bff;
    border-radius: 6px;
}
.player-seat.folded {
    opacity: 0.4;
}
.player-seat.eliminated {
    opacity: 0.2;
}

/* Cards within each seat */
.player-seat .cards {
    display: flex;
    justify-content: center;
    gap: 3px;
}
.player-seat .cards .card {
    width: 32px;
    height: 48px;
    border: 1px solid #999;
    border-radius: 4px;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: bold;
    color: #333;
}
.player-seat .cards .card.back {
    background: #444;
    border-color: #666;
    color: transparent;
}

/* Player info (name and chips) */
.player-seat .player-info {
    margin-top: 3px;
    font-size: 0.7rem;
    color: #fff;
    line-height: 1.1;
}
.player-seat .player-info .name {
    font-weight: bold;
}
.player-seat .player-info .chips {
    font-style: italic;
}

/* Bet display with chip icon */
.player-seat .bet {
    margin-top: 2px;
    font-size: 0.7rem;
    color: #ffc107;
    display: flex;
    align-items: center;
    justify-content: center;
}
.player-seat .chip-icon {
    width: 12px;
    height: 12px;
    margin-right: 3px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, #ffe066 0%, #f2a900 60%, #c58d00 100%);
}

/* Ensure action area and message area are spaced relative to table */
#actionArea {
    margin-top: 10px;
}
#messageArea {
    margin-top: 10px;
}

.players-area {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin-bottom: 20px;
}

.player {
    background: white;
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 5px 10px;
    min-width: 120px;
    text-align: left;
    font-size: 0.9rem;
    position: relative;
}

.player.current-turn {
    border-color: #007bff;
    box-shadow: 0 0 5px rgba(0, 123, 255, 0.6);
}

.player.folded {
    opacity: 0.5;
}

.card-container {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-bottom: 10px;
}

.card {
    width: 50px;
    height: 70px;
    border: 1px solid #999;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    font-weight: bold;
    background: #fff;
}

.card.hidden {
    background: #d0d0d0;
    color: #d0d0d0;
}

.action-area {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin-top: 15px;
}

.message-area {
    margin-top: 20px;
    min-height: 40px;
    font-size: 0.95rem;
    color: #333;
}
