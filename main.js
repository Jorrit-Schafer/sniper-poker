/*
 * Sniper Hold'em client logic
 *
 * This script implements the core logic for hosting or joining games and
 * orchestrating a hand of Sniper Hold'em. It uses Firebase for realtime
 * synchronisation of game state across all connected clients. The static
 * website can be hosted on GitHub Pages or any other static hosting and
 * requires no server‑side code beyond your Firebase project. To run this
 * yourself you need to create a Firebase project, enable the Firestore
 * database and allow public read/write access for development, then fill
 * in your configuration below. The Firebase documentation shows that you
 * can import only the SDKs you need via the CDN and initialise your app
 * with your own configuration【926625994547711†L450-L491】.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

// TODO: Replace the following with your project's Firebase configuration.
// You can find these values in your Firebase console under your app settings.
// See https://firebase.google.com/docs/web/setup for details.
const firebaseConfig = {
  apiKey: "AIzaSyA7sQscjjawGtWwTLO8S7OMPjWywVRaYfs",
  authDomain: "sniper-hold-em.firebaseapp.com",
  projectId: "sniper-hold-em",
  storageBucket: "sniper-hold-em.firebasestorage.app",
  messagingSenderId: "467999048041",
  appId: "1:467999048041:web:197d1877c0037536cd3df8"
};

// Only initialise Firebase if a configuration has been provided.
let db;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  console.warn('Firebase initialisation failed. Please provide your configuration in main.js.');
}

// UI elements
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const nameInput = document.getElementById('nameInput');
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const gameIdInput = document.getElementById('gameIdInput');
const lobbyStatus = document.getElementById('lobbyStatus');

// Game area elements
const playerNameSpan = document.getElementById('playerName');
const playerChipsSpan = document.getElementById('playerChips');
const potSpan = document.getElementById('pot');
const phaseSpan = document.getElementById('phase');
const playersArea = document.getElementById('playersArea');
const communityCardsDiv = document.getElementById('communityCards');
const holeCardsDiv = document.getElementById('holeCards');
const callBtn = document.getElementById('callBtn');
const raiseBtn = document.getElementById('raiseBtn');
const foldBtn = document.getElementById('foldBtn');
const raiseAmountInput = document.getElementById('raiseAmount');
const snipeBtn = document.getElementById('snipeBtn');
const snipeInput = document.getElementById('snipeInput');
const submitSnipeBtn = document.getElementById('submitSnipeBtn');
const messageArea = document.getElementById('messageArea');

// Current user and game identifiers.  We attempt to restore these from
// localStorage so that a page reload does not change the host's ID and
// prevent them from starting a game.  If the storage is unavailable or
// the values are not present we fall back to null.
let myPlayerId = null;
let myName = null;
let currentGameId = null;
try {
  const storedId = localStorage.getItem('sniper_myPlayerId');
  const storedName = localStorage.getItem('sniper_myName');
  const storedGame = localStorage.getItem('sniper_currentGameId');
  if (storedId) myPlayerId = storedId;
  if (storedName) myName = storedName;
  if (storedGame) currentGameId = storedGame;
} catch (err) {
  // localStorage may be unavailable in some contexts (e.g. private
  // browsing) so ignore any errors here.
}
let unsubscribe = null;

// Utility: generate a random 4‑letter/number game code
function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Utility: shuffle an array in place (Fisher–Yates)
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// Utility: compute next active player's index (skipping folded/eliminated players and those with zero chips).
function nextActiveIndex(players, startIndex) {
  if (!players || players.length === 0) return 0;
  let idx = startIndex;
  do {
    idx = (idx + 1) % players.length;
    const p = players[idx];
    if (!p.eliminated && p.chips > 0) {
      return idx;
    }
  } while (idx !== startIndex);
  return startIndex;
}

// Utility: evaluate the rank of a 5‑card hand (array of numbers)
// Returns an array where the first element is the ranking category (higher is better)
// and subsequent elements are tie breakers (sorted descending). Ranking categories:
// 7: Four of a Kind, 6: Full House, 5: Straight, 4: Three of a Kind,
// 3: Two Pair, 2: One Pair, 1: High Card
function evaluateHand(cards) {
  // Count occurrences
  const counts = {};
  for (const c of cards) {
    counts[c] = (counts[c] || 0) + 1;
  }
  const values = Object.keys(counts).map(n => parseInt(n));
  values.sort((a, b) => b - a);
  const countArr = values.map(v => counts[v]);
  // Sort values by count descending then value descending
  const sorted = values.slice().sort((a, b) => {
    if (counts[b] === counts[a]) return b - a;
    return counts[b] - counts[a];
  });
  // Determine if straight: 5 distinct values and max - min == 4
  let isStraight = false;
  if (cards.length === 5) {
    const uniqueVals = Array.from(new Set(cards)).sort((a, b) => a - b);
    if (uniqueVals.length === 5) {
      const min = uniqueVals[0];
      const max = uniqueVals[4];
      if (max - min === 4) {
        isStraight = true;
      }
    }
  }
  // Determine ranking
  let rankCategory;
  if (countArr.includes(4)) {
    rankCategory = 7; // Four of a Kind
  } else if (countArr.includes(3) && countArr.includes(2)) {
    rankCategory = 6; // Full House
  } else if (isStraight) {
    rankCategory = 5; // Straight
  } else if (countArr.includes(3)) {
    rankCategory = 4; // Three of a Kind
  } else if (countArr.filter(c => c === 2).length === 2) {
    rankCategory = 3; // Two Pair
  } else if (countArr.includes(2)) {
    rankCategory = 2; // One Pair
  } else {
    rankCategory = 1; // High Card
  }
  // Build tie breaker values: start with high card order from sorted counts
  const tieBreakers = [];
  if (rankCategory === 7) {
    // Four of a Kind: [quad value, kicker]
    const quadVal = sorted.find(v => counts[v] === 4);
    const kicker = sorted.find(v => counts[v] === 1);
    tieBreakers.push(quadVal, kicker);
  } else if (rankCategory === 6) {
    // Full House: [trip value, pair value]
    const trip = sorted.find(v => counts[v] === 3);
    const pair = sorted.find(v => counts[v] === 2);
    tieBreakers.push(trip, pair);
  } else if (rankCategory === 5) {
    // Straight: [highest card]
    const highest = Math.max(...cards);
    tieBreakers.push(highest);
  } else if (rankCategory === 4) {
    // Three of a kind: [trip value, highest kicker, second kicker]
    const tripVal = sorted.find(v => counts[v] === 3);
    const kickers = sorted.filter(v => counts[v] === 1);
    tieBreakers.push(tripVal, ...kickers.slice(0, 2));
  } else if (rankCategory === 3) {
    // Two Pair: [highest pair, second pair, kicker]
    const pairs = sorted.filter(v => counts[v] === 2);
    const kicker = sorted.find(v => counts[v] === 1);
    tieBreakers.push(pairs[0], pairs[1], kicker);
  } else if (rankCategory === 2) {
    // One Pair: [pair value, three kickers]
    const pair = sorted.find(v => counts[v] === 2);
    const kickers = sorted.filter(v => counts[v] === 1);
    tieBreakers.push(pair, ...kickers.slice(0, 3));
  } else {
    // High card: top five cards
    const sortedVals = cards.slice().sort((a, b) => b - a);
    tieBreakers.push(...sortedVals);
  }
  return [rankCategory, ...tieBreakers];
}

// Compare two ranking arrays; return positive if a > b, negative if a < b, 0 if equal
function compareRanks(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Determine the best non‑sniped 5‑card hand for a player given community cards and snipes.
function bestHandForPlayer(player, communityCards, snipes) {
  const cards = [...player.hole, ...communityCards];
  // All combinations of 5 cards from 6 cards (index combinations of 6 choose 5). There are 6 combinations.
  const combinations = [];
  // For 6 cards [0,1,2,3,4,5], 6 choose 5 => exclude each index once
  for (let skip = 0; skip < cards.length; skip++) {
    const combo = [];
    for (let i = 0; i < cards.length; i++) {
      if (i !== skip) combo.push(cards[i]);
    }
    combinations.push(combo);
  }
  let bestRank = [0];
  let bestComboStr = null;
  for (const combo of combinations) {
    const sortedStr = combo.slice().sort((a, b) => a - b).join('-');
    if (snipes && snipes.includes(sortedStr)) {
      // this combo is sniped, skip
      continue;
    }
    const rank = evaluateHand(combo);
    if (compareRanks(rank, bestRank) > 0) {
      bestRank = rank;
      bestComboStr = sortedStr;
    }
  }
  // If all combos sniped, bestRank remains [0] indicating invalid hand
  return { rank: bestRank, comboStr: bestComboStr };
}

// Render lobby UI with list of players and game ID if available
function renderLobby(game) {
  if (!game) return;
  if (!game.players) return;
  /*
   * Show both the current game ID and the list of players.  When a host
   * creates a game the status message showing the game code is
   * immediately overwritten on the next Firestore snapshot by the
   * original implementation.  Many users thought no game code was
   * generated because the message disappeared so quickly.  To address
   * this the lobby now always displays the current game ID alongside
   * the list of players.  The global variable `currentGameId` is set
   * whenever a game is created or joined so we can reuse it here.
   */
  const names = game.players.map(p => p.name).join(', ');
  if (currentGameId) {
    lobbyStatus.textContent = `Game ID: ${currentGameId} — Players: ${names}`;
  } else {
    lobbyStatus.textContent = `Players: ${names}`;
  }
  // Show start button if current user is host and there are at least 2 players
  const isHost = (game.creatorId === myPlayerId);
  let startBtn = document.getElementById('startGameBtn');
  if (isHost && game.players.length >= 2 && !game.started) {
    if (!startBtn) {
      startBtn = document.createElement('button');
      startBtn.id = 'startGameBtn';
      startBtn.textContent = 'Start Game';
      startBtn.onclick = async () => {
        await startHand(game);
      };
      lobbyDiv.appendChild(startBtn);
    }
  } else {
    if (startBtn) startBtn.remove();
  }
}

// Render game UI from the current game state
function renderGame(game) {
  if (!game) return;
  // Update top bar
  playerNameSpan.textContent = myName;
  phaseSpan.textContent = game.phase;
  potSpan.textContent = game.pot;
  // Find my player object
  const myPlayer = game.players.find(p => p.id === myPlayerId);
  if (myPlayer) {
    playerChipsSpan.textContent = myPlayer.chips;
  }
  // Render community cards
  communityCardsDiv.innerHTML = '';
  for (let i = 0; i < game.communityCards.length; i++) {
    const cardVal = game.communityCards[i];
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.textContent = cardVal;
    communityCardsDiv.appendChild(cardEl);
  }
  // Render hole cards
  holeCardsDiv.innerHTML = '';
  if (myPlayer && myPlayer.hole) {
    myPlayer.hole.forEach(val => {
      const c = document.createElement('div');
      c.className = 'card';
      c.textContent = val;
      holeCardsDiv.appendChild(c);
    });
  }
  // Render players area
  playersArea.innerHTML = '';
  game.players.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'player';
    if (idx === game.currentPlayerIndex && game.phase !== 'sniping' && game.phase !== 'showdown' && game.phase !== 'finished') {
      div.classList.add('current-turn');
    }
    if (p.folded) {
      div.classList.add('folded');
    }
    div.innerHTML = `<strong>${p.name}</strong><br>Chips: ${p.chips}<br>Bet: ${p.bet}`;
    playersArea.appendChild(div);
  });
  // Clear message area
  messageArea.textContent = '';
  // Determine available actions
  // Disable all by default
  callBtn.disabled = true;
  raiseBtn.disabled = true;
  raiseAmountInput.disabled = true;
  foldBtn.disabled = true;
  snipeBtn.style.display = 'none';
  snipeInput.style.display = 'none';
  submitSnipeBtn.style.display = 'none';
  // Only if game has started and not finished
  if (game.phase === 'preflop' || game.phase === 'flop' || game.phase === 'turn') {
    // It's my turn if I'm the current player and I'm not folded
    if (game.players[game.currentPlayerIndex] && game.players[game.currentPlayerIndex].id === myPlayerId) {
      if (!myPlayer.folded) {
        callBtn.disabled = false;
        raiseBtn.disabled = false;
        raiseAmountInput.disabled = false;
        foldBtn.disabled = false;
      }
    }
  } else if (game.phase === 'sniping') {
    // Sniping phase
    if (game.snipes === undefined) game.snipes = [];
    if (game.snipingIndex !== undefined && game.players[game.snipingIndex] && game.players[game.snipingIndex].id === myPlayerId) {
      // show snipe controls
      snipeBtn.style.display = '';
      snipeInput.style.display = 'none';
      submitSnipeBtn.style.display = 'none';
      snipeBtn.onclick = () => {
        snipeBtn.style.display = 'none';
        snipeInput.style.display = '';
        submitSnipeBtn.style.display = '';
      };
      submitSnipeBtn.onclick = async () => {
        const handStr = snipeInput.value.trim();
        snipeInput.value = '';
        await submitSnipe(handStr);
      };
    }
  } else if (game.phase === 'showdown' || game.phase === 'finished') {
    // Show outcome message if available
    if (game.outcomeMessage) {
      messageArea.textContent = game.outcomeMessage;
    }
    // Provide a button for the host to start next hand if game not over
    if (game.creatorId === myPlayerId && !game.gameOver) {
      let nextBtn = document.getElementById('nextHandBtn');
      if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'nextHandBtn';
        nextBtn.textContent = 'Next Hand';
        nextBtn.onclick = async () => {
          await startHand(game);
          nextBtn.remove();
        };
        messageArea.appendChild(nextBtn);
      }
    }
  }
}

// Listen to changes in the current game document
async function subscribeToGame(gameId) {
  if (unsubscribe) unsubscribe();
  const docRef = doc(db, 'games', gameId);
  unsubscribe = onSnapshot(docRef, (snapshot) => {
    const game = snapshot.data();
    if (!game) {
      messageArea.textContent = 'Game no longer exists.';
      return;
    }
    // Update UI depending on phase
    if (!game.started) {
      renderLobby(game);
    } else {
      lobbyDiv.style.display = 'none';
      gameDiv.style.display = '';
      renderGame(game);
    }
  });
}

// Handle create game
createGameBtn.addEventListener('click', async () => {
  if (!db) {
    lobbyStatus.textContent = 'Firebase is not initialised. Please edit main.js with your config.';
    return;
  }
  const name = nameInput.value.trim();
  if (!name) {
    lobbyStatus.textContent = 'Enter a name.';
    return;
  }
  myName = name;
  // Create a unique identifier for this player. crypto.randomUUID() is available in
  // modern browsers; fall back to a random string if unavailable.  Persist
  // this ID and name in localStorage so that reloading the page does not
  // create a new ID (which would cause the host to lose control of the game).
  myPlayerId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : generateGameCode() + Date.now();
  const gameId = generateGameCode();
  currentGameId = gameId;
  try {
    localStorage.setItem('sniper_myPlayerId', myPlayerId);
    localStorage.setItem('sniper_myName', myName);
    localStorage.setItem('sniper_currentGameId', currentGameId);
  } catch (_) {
    // ignore storage errors
  }
  // Create game document with initial fields
  const gameData = {
    creatorId: myPlayerId,
    createdAt: serverTimestamp(),
    players: [
      {
        id: myPlayerId,
        name: myName,
        chips: 60,
        hole: [],
        bet: 0,
        folded: false,
        eliminated: false,
      },
    ],
    started: false,
    handNumber: 0,
    dealerIndex: 0,
    smallBlind: 1,
    bigBlind: 2,
    pot: 0,
    communityCards: [],
    deck: [],
    phase: 'lobby',
    bettingRound: 0,
    currentBet: 0,
    currentPlayerIndex: 0,
    lastAggressivePlayerIndex: 0,
    snipes: [],
    snipingIndex: 0,
    snipingStartIndex: 0,
    gameOver: false,
    outcomeMessage: '',
  };
  await setDoc(doc(db, 'games', currentGameId), gameData);
  lobbyDiv.style.display = '';
  gameDiv.style.display = 'none';
  lobbyStatus.textContent = `Game created with ID ${gameId}. Share this ID with friends to join.`;
  subscribeToGame(gameId);
});

// Handle join game
joinGameBtn.addEventListener('click', async () => {
  if (!db) {
    lobbyStatus.textContent = 'Firebase is not initialised. Please edit main.js with your config.';
    return;
  }
  const name = nameInput.value.trim();
  const gameId = gameIdInput.value.trim().toUpperCase();
  if (!name || !gameId) {
    lobbyStatus.textContent = 'Enter your name and game ID to join.';
    return;
  }
  myName = name;
  myPlayerId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : generateGameCode() + Date.now();
  currentGameId = gameId;
  try {
    localStorage.setItem('sniper_myPlayerId', myPlayerId);
    localStorage.setItem('sniper_myName', myName);
    localStorage.setItem('sniper_currentGameId', currentGameId);
  } catch (_) {
    // ignore storage errors
  }
  const docRef = doc(db, 'games', gameId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    lobbyStatus.textContent = 'No such game exists.';
    return;
  }
  const game = snap.data();
  if (game.started) {
    lobbyStatus.textContent = 'Game has already started.';
    return;
  }
  if (game.players.length >= 6) {
    lobbyStatus.textContent = 'Game is full (max 6 players).';
    return;
  }
  // Add this player to the players array
  const updatedPlayers = [...game.players, {
    id: myPlayerId,
    name: myName,
    chips: 60,
    hole: [],
    bet: 0,
    folded: false,
    eliminated: false,
  }];
  await updateDoc(docRef, { players: updatedPlayers });
  lobbyStatus.textContent = `Joined game ${gameId}.`;
  subscribeToGame(gameId);
});

// Host: start a new hand
async function startHand(game) {
  if (!db) return;
  if (!game || game.gameOver) return;
  const docRef = doc(db, 'games', currentGameId);
  // Determine new dealer index (increment previous dealer)
  let dealerIndex = game.dealerIndex || 0;
  if (game.handNumber > 0) {
    // Move dealer to next active
    dealerIndex = nextActiveIndex(game.players, dealerIndex);
  }
  // Filter active players (non‑eliminated with chips)
  const activePlayers = game.players.filter(p => !p.eliminated && p.chips > 0);
  // If fewer than 2 active players, game over
  if (activePlayers.length < 2) {
    await updateDoc(docRef, { gameOver: true, outcomeMessage: `${activePlayers[0].name} wins the game!` });
    return;
  }
  // Create new deck (1–10 each with four copies)
  const deck = [];
  for (let i = 1; i <= 10; i++) {
    for (let j = 0; j < 4; j++) {
      deck.push(i);
    }
  }
  shuffle(deck);
  // Reset players for new hand
  const players = game.players.map((p) => {
    const newP = { ...p };
    if (newP.eliminated || newP.chips <= 0) {
      newP.eliminated = true;
      newP.hole = [];
      newP.bet = 0;
      newP.folded = true;
    } else {
      newP.hole = [deck.pop(), deck.pop()];
      newP.bet = 0;
      newP.folded = false;
    }
    newP.hasActed = false;
    return newP;
  });
  // Determine small and big blind positions
  let smallBlindIdx = nextActiveIndex(players, dealerIndex);
  let bigBlindIdx = nextActiveIndex(players, smallBlindIdx);
  // Place blinds
  let pot = 0;
  let currentBet = 0;
  const sbAmount = game.smallBlind || 1;
  const bbAmount = game.bigBlind || 2;
  const sbPlayer = players[smallBlindIdx];
  const bbPlayer = players[bigBlindIdx];
  const sbPay = Math.min(sbAmount, sbPlayer.chips);
  sbPlayer.chips -= sbPay;
  sbPlayer.bet = sbPay;
  pot += sbPay;
  const bbPay = Math.min(bbAmount, bbPlayer.chips);
  bbPlayer.chips -= bbPay;
  bbPlayer.bet = bbPay;
  pot += bbPay;
  currentBet = Math.max(sbPay, bbPay);
  // Each blind acts implicitly
  players.forEach(p => p.hasActed = false);
  sbPlayer.hasActed = false; // they still need to respond if raise
  bbPlayer.hasActed = false;
  // Set last aggressive to big blind
  let lastAggressivePlayerIndex = bigBlindIdx;
  // Current player is player after big blind
  let currentPlayerIndex = nextActiveIndex(players, bigBlindIdx);
  // Reset other fields
  const update = {
    players,
    dealerIndex,
    deck,
    communityCards: [],
    pot,
    currentBet,
    currentPlayerIndex,
    lastAggressivePlayerIndex,
    bettingRound: 0,
    phase: 'preflop',
    snipes: [],
    snipingIndex: 0,
    snipingStartIndex: 0,
    started: true,
    handNumber: (game.handNumber || 0) + 1,
    outcomeMessage: '',
  };
  await updateDoc(docRef, update);
}

// Perform a call action
async function callAction() {
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef);
  const game = snap.data();
  const idx = game.currentPlayerIndex;
  const player = game.players[idx];
  if (player.id !== myPlayerId) return;
  if (player.folded) return;
  const diff = game.currentBet - player.bet;
  const pay = Math.min(diff, player.chips);
  player.chips -= pay;
  player.bet += pay;
  game.pot += pay;
  player.hasActed = true;
  // Check if this ends the round
  let nextIdx = nextActiveIndex(game.players, idx);
  let endRound = false;
  // Determine if all active players have matched currentBet or are folded
  const allMatched = game.players.every((p) => p.folded || p.eliminated || p.bet === game.currentBet);
  if (idx === game.lastAggressivePlayerIndex && allMatched) {
    endRound = true;
  }
  // Update players array in game
  game.players[idx] = player;
  if (endRound) {
    await advanceRound(game);
  } else {
    await updateDoc(docRef, {
      players: game.players,
      pot: game.pot,
      currentPlayerIndex: nextIdx,
    });
  }
}

// Perform a raise action
async function raiseAction(amount) {
  const raiseAmount = parseInt(amount);
  if (isNaN(raiseAmount) || raiseAmount <= 0) {
    messageArea.textContent = 'Invalid raise amount.';
    return;
  }
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef);
  const game = snap.data();
  const idx = game.currentPlayerIndex;
  const player = game.players[idx];
  if (player.id !== myPlayerId) return;
  if (player.folded) return;
  const newBet = game.currentBet + raiseAmount;
  const diff = newBet - player.bet;
  const pay = Math.min(diff, player.chips);
  player.chips -= pay;
  player.bet += pay;
  game.pot += pay;
  game.currentBet = player.bet;
  game.lastAggressivePlayerIndex = idx;
  // Reset hasActed flags for all players except raiser
  game.players.forEach((p) => {
    if (!p.folded && !p.eliminated) {
      p.hasActed = (p.id === player.id);
    }
  });
  // Update players array
  game.players[idx] = player;
  const nextIdx = nextActiveIndex(game.players, idx);
  await updateDoc(docRef, {
    players: game.players,
    pot: game.pot,
    currentBet: game.currentBet,
    lastAggressivePlayerIndex: game.lastAggressivePlayerIndex,
    currentPlayerIndex: nextIdx,
  });
}

// Perform a fold action
async function foldAction() {
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef);
  const game = snap.data();
  const idx = game.currentPlayerIndex;
  const player = game.players[idx];
  if (player.id !== myPlayerId) return;
  player.folded = true;
  player.hasActed = true;
  // Check if only one active player remains
  const activeIndices = game.players.filter(p => !p.folded && !p.eliminated).map((p, index) => index);
  if (activeIndices.length === 1) {
    // Award pot to that player
    const winnerIdx = activeIndices[0];
    game.players[winnerIdx].chips += game.pot;
    const outcome = `${game.players[winnerIdx].name} wins ${game.pot} chips (all others folded)`;
    // Reset pot and phase
    game.pot = 0;
    game.phase = 'finished';
    game.outcomeMessage = outcome;
    // Mark hand finished
    await updateDoc(docRef, {
      players: game.players,
      pot: game.pot,
      phase: game.phase,
      outcomeMessage: game.outcomeMessage,
    });
    return;
  }
  // Determine next player and check end of round
  const nextIdx = nextActiveIndex(game.players, idx);
  let endRound = false;
  const allMatched = game.players.every((p) => p.folded || p.eliminated || p.bet === game.currentBet);
  // If the folding player was lastAggressive, move lastAggressive to previous active
  if (idx === game.lastAggressivePlayerIndex) {
    // set lastAggressive to previous active player
    let prev = idx;
    do {
      prev = (prev - 1 + game.players.length) % game.players.length;
      if (!game.players[prev].folded && !game.players[prev].eliminated) break;
    } while (true);
    game.lastAggressivePlayerIndex = prev;
  }
  if (idx === game.lastAggressivePlayerIndex && allMatched) {
    endRound = true;
  }
  // Update players array
  game.players[idx] = player;
  if (endRound) {
    await advanceRound(game);
  } else {
    await updateDoc(docRef, {
      players: game.players,
      currentPlayerIndex: nextIdx,
      lastAggressivePlayerIndex: game.lastAggressivePlayerIndex,
    });
  }
}

// Advance to next betting round, sniping or showdown as appropriate
async function advanceRound(game) {
  const docRef = doc(db, 'games', currentGameId);
  // Reset players' bet and hasActed flags
  game.players.forEach((p) => {
    p.bet = 0;
    p.hasActed = false;
  });
  if (game.bettingRound === 0) {
    // Move to flop (deal two cards)
    const deck = game.deck;
    const card1 = deck.pop();
    const card2 = deck.pop();
    game.communityCards.push(card1, card2);
    game.bettingRound = 1;
    game.phase = 'flop';
    game.currentBet = 0;
    // first to act is player left of dealer
    const firstToAct = nextActiveIndex(game.players, game.dealerIndex);
    game.lastAggressivePlayerIndex = firstToAct;
    game.currentPlayerIndex = firstToAct;
    await updateDoc(docRef, {
      players: game.players,
      communityCards: game.communityCards,
      deck: deck,
      bettingRound: game.bettingRound,
      phase: game.phase,
      currentBet: game.currentBet,
      lastAggressivePlayerIndex: game.lastAggressivePlayerIndex,
      currentPlayerIndex: game.currentPlayerIndex,
    });
  } else if (game.bettingRound === 1) {
    // Move to turn (deal two more cards)
    const deck = game.deck;
    const card3 = deck.pop();
    const card4 = deck.pop();
    game.communityCards.push(card3, card4);
    game.bettingRound = 2;
    game.phase = 'turn';
    game.currentBet = 0;
    const firstToAct = nextActiveIndex(game.players, game.dealerIndex);
    game.lastAggressivePlayerIndex = firstToAct;
    game.currentPlayerIndex = firstToAct;
    await updateDoc(docRef, {
      players: game.players,
      communityCards: game.communityCards,
      deck: deck,
      bettingRound: game.bettingRound,
      phase: game.phase,
      currentBet: game.currentBet,
      lastAggressivePlayerIndex: game.lastAggressivePlayerIndex,
      currentPlayerIndex: game.currentPlayerIndex,
    });
  } else if (game.bettingRound === 2) {
    // End betting, go to sniping phase
    game.phase = 'sniping';
    // Set sniping start index to last aggressive player
    game.snipingStartIndex = game.lastAggressivePlayerIndex;
    game.snipingIndex = game.lastAggressivePlayerIndex;
    await updateDoc(docRef, {
      players: game.players,
      phase: game.phase,
      snipingIndex: game.snipingIndex,
      snipingStartIndex: game.snipingStartIndex,
    });
  }
}

// Submit a snipe declaration (handStr can be empty to skip)
async function submitSnipe(handStr) {
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef);
  const game = snap.data();
  if (game.phase !== 'sniping') return;
  // Only act if it's our turn
  if (game.players[game.snipingIndex].id !== myPlayerId) return;
  // Add snipe if provided
  const snipes = game.snipes || [];
  const trimmed = handStr.replace(/\s+/g, '');
  if (trimmed) {
    // Validate the format: e.g. "6-7-8-9-10"
    const parts = trimmed.split('-');
    const numbers = parts.map(x => parseInt(x));
    if (numbers.length === 5 && numbers.every(n => !isNaN(n) && n >= 1 && n <= 10)) {
      const sorted = numbers.slice().sort((a, b) => a - b);
      snipes.push(sorted.join('-'));
    }
  }
  // Determine next sniping index
  let nextIdx = nextActiveIndex(game.players, game.snipingIndex);
  // If we loop back to start, end sniping and go to showdown
  if (nextIdx === game.snipingStartIndex) {
    // Proceed to showdown
    await resolveShowdown(game, snipes);
  } else {
    await updateDoc(docRef, {
      snipes: snipes,
      snipingIndex: nextIdx,
    });
  }
}

// Resolve showdown: determine winner(s) and distribute pot
async function resolveShowdown(game, snipes) {
  const docRef = doc(db, 'games', currentGameId);
  const activePlayers = game.players.filter(p => !p.folded && !p.eliminated);
  const results = [];
  for (const p of activePlayers) {
    const { rank, comboStr } = bestHandForPlayer(p, game.communityCards, snipes);
    results.push({ player: p, rank, comboStr });
  }
  // Determine highest rank
  let bestRank = [0];
  results.forEach(res => {
    if (compareRanks(res.rank, bestRank) > 0) {
      bestRank = res.rank;
    }
  });
  // Determine winners (could be multiple)
  const winners = results.filter(res => compareRanks(res.rank, bestRank) === 0);
  // Distribute pot evenly among winners
  const share = Math.floor(game.pot / winners.length);
  let remainder = game.pot % winners.length;
  winners.forEach(res => {
    res.player.chips += share;
    if (remainder > 0) {
      res.player.chips += 1;
      remainder--;
    }
  });
  // Compose outcome message
  let outcome;
  if (winners.length === 1) {
    outcome = `${winners[0].player.name} wins ${game.pot} chips.`;
  } else {
    const names = winners.map(w => w.player.name).join(' and ');
    outcome = `${names} split the pot of ${game.pot} chips.`;
  }
  // Reset pot
  game.pot = 0;
  // Update players array with new chip counts
  const updatedPlayers = game.players.map(p => {
    const res = winners.find(w => w.player.id === p.id);
    if (res) {
      return { ...res.player };
    }
    return { ...p };
  });
  // Check for eliminations
  updatedPlayers.forEach(p => {
    if (p.chips <= 0) {
      p.eliminated = true;
    }
  });
  // Check if someone reached the target (75 chips)
  let gameOver = false;
  let overallWinner = null;
  updatedPlayers.forEach(p => {
    if (p.chips >= 75) {
      gameOver = true;
      overallWinner = p;
    }
  });
  await updateDoc(docRef, {
    players: updatedPlayers,
    pot: game.pot,
    phase: 'finished',
    outcomeMessage: outcome,
    gameOver: gameOver,
  });
  if (gameOver && overallWinner) {
    await updateDoc(docRef, {
      outcomeMessage: `${overallWinner.name} has reached 75 chips and wins the game!`,
    });
  }
}

// Wire up UI buttons to actions
callBtn.addEventListener('click', () => {
  callAction();
});

raiseBtn.addEventListener('click', () => {
  const amount = raiseAmountInput.value;
  raiseAction(amount);
});

foldBtn.addEventListener('click', () => {
  foldAction();
});
