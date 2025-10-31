/*
 * Sniper Poker — Last Person Standing version
 *
 * This file consolidates gameplay fixes and removes any fixed-chip win
 * condition. Players are only eliminated when they have 0 chips, and the
 * last player with chips wins the game.
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

// ========================= Firebase =========================
// Replace with your project configuration
const firebaseConfig = {
  apiKey: "AIzaSyA7sQscjjawGtWwTLO8S7OMPjWywVRaYfs",
  authDomain: "sniper-hold-em.firebaseapp.com",
  projectId: "sniper-hold-em",
  storageBucket: "sniper-hold-em.firebasestorage.app",
  messagingSenderId: "467999048041",
  appId: "1:467999048041:web:197d1877c0037536cd3df8",
};

let db;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  console.warn('Firebase initialisation failed. Please provide your configuration in main.js.');
}

// ========================= DOM =========================
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const nameInput = document.getElementById('nameInput');
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const gameIdInput = document.getElementById('gameIdInput');
const lobbyStatus = document.getElementById('lobbyStatus');
const startGameContainer = document.getElementById('startGameContainer');

const playerNameSpan = document.getElementById('playerName');
const playerChipsSpan = document.getElementById('playerChips');
const potSpan = document.getElementById('pot');
const phaseSpan = document.getElementById('phase');
const communityCardsDiv = document.getElementById('communityCards');
const callBtn = document.getElementById('callBtn');
const raiseBtn = document.getElementById('raiseBtn');
const foldBtn = document.getElementById('foldBtn');
const raiseAmountInput = document.getElementById('raiseAmount');
const confirmRaiseBtn = document.getElementById('confirmRaiseBtn');
const cancelRaiseBtn = document.getElementById('cancelRaiseBtn');
const snipeBtn = document.getElementById('snipeBtn');
const snipeInput = document.getElementById('snipeInput');
const snipeComboSelect = document.getElementById('snipeComboSelect');
const snipeHighSelect = document.getElementById('snipeHighSelect');
const submitSnipeBtn = document.getElementById('submitSnipeBtn');
const messageArea = document.getElementById('messageArea');
const snipesDisplay = document.getElementById('snipesDisplay');
const callTimeBtn = document.getElementById('callTimeBtn');

// ========================= State =========================
let myPlayerId = null;
let myName = null;
let currentGameId = null;
let unsubscribe = null;

// Timer state for "call time"
let callTimerIntervalId = null;

// ========================= Utilities =========================
function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function shuffle(array) {
  const n = array.length;
  const uint32 = window.crypto.getRandomValues(new Uint32Array(n));
  for (let i = n - 1; i > 0; i--) {
    const j = uint32[i] % (i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function getSeatPositions(numPlayers) {
  const positions = [];
  const count = Math.max(2, Math.min(numPlayers, 9));
  const xRadius = 40;
  const yRadius = 28;
  const startDeg = 90;
  const stepDeg = 360 / count;
  for (let i = 0; i < count; i++) {
    const angleDeg = startDeg + i * stepDeg;
    const angleRad = angleDeg * Math.PI / 180;
    const x = 50 + xRadius * Math.cos(angleRad);
    const y = 50 + yRadius * Math.sin(angleRad);
    positions.push({ x, y });
  }
  return positions;
}

function nextActiveIndex(players, startIndex) {
  if (!players || players.length === 0) return 0;
  let idx = startIndex;
  do {
    idx = (idx + 1) % players.length;
    const p = players[idx];
    if (!p.eliminated && p.chips > 0 && !p.folded) return idx;
  } while (idx !== startIndex);
  return startIndex;
}

// Hand evaluation (numbers only 1-10; no suits; no flushes)
function evaluateHand(cards) {
  const counts = {};
  for (const c of cards) counts[c] = (counts[c] || 0) + 1;
  const values = Object.keys(counts).map(n => parseInt(n)).sort((a, b) => b - a);
  const countArr = values.map(v => counts[v]);
  const sorted = values.slice().sort((a, b) => counts[b] === counts[a] ? b - a : counts[b] - counts[a]);

  let isStraight = false;
  if (cards.length === 5) {
    const uniqueVals = Array.from(new Set(cards)).sort((a, b) => a - b);
    if (uniqueVals.length === 5) {
      const min = uniqueVals[0];
      const max = uniqueVals[4];
      if (max - min === 4) isStraight = true;
    }
  }

  let rankCategory;
  if (countArr.includes(4)) rankCategory = 7;            // Quads
  else if (countArr.includes(3) && countArr.includes(2)) rankCategory = 6; // Full house
  else if (isStraight) rankCategory = 5;                  // Straight
  else if (countArr.includes(3)) rankCategory = 4;        // Trips
  else if (countArr.filter(c => c === 2).length === 2) rankCategory = 3; // Two pair
  else if (countArr.includes(2)) rankCategory = 2;        // One pair
  else rankCategory = 1;                                  // High card

  const tieBreakers = [];
  if (rankCategory === 7) { // quads
    const quadVal = sorted.find(v => counts[v] === 4);
    const kicker = sorted.find(v => counts[v] === 1);
    tieBreakers.push(quadVal, kicker);
  } else if (rankCategory === 6) { // full house
    const trip = sorted.find(v => counts[v] === 3);
    const pair = sorted.find(v => counts[v] === 2);
    tieBreakers.push(trip, pair);
  } else if (rankCategory === 5) { // straight
    tieBreakers.push(Math.max(...cards));
  } else if (rankCategory === 4) { // trips
    const tripVal = sorted.find(v => counts[v] === 3);
    const kickers = sorted.filter(v => counts[v] === 1);
    tieBreakers.push(tripVal, ...kickers.slice(0, 2));
  } else if (rankCategory === 3) { // two pair
    const pairs = sorted.filter(v => counts[v] === 2);
    const kicker = sorted.find(v => counts[v] === 1);
    tieBreakers.push(pairs[0], pairs[1], kicker);
  } else if (rankCategory === 2) { // one pair
    const pair = sorted.find(v => counts[v] === 2);
    const kickers = sorted.filter(v => counts[v] === 1);
    tieBreakers.push(pair, ...kickers.slice(0, 3));
  } else { // high card
    tieBreakers.push(...cards.slice().sort((a, b) => b - a));
  }
  return [rankCategory, ...tieBreakers];
}

function compareRanks(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function bestHandForPlayer(player, communityCards, snipes) {
  const cards = [...player.hole, ...communityCards];
  const combinations = [];
  for (let skip = 0; skip < cards.length; skip++) {
    const combo = [];
    for (let i = 0; i < cards.length; i++) if (i !== skip) combo.push(cards[i]);
    combinations.push(combo);
  }
  let bestRank = [0];
  let bestComboStr = null;
  for (const combo of combinations) {
    const sortedStr = combo.slice().sort((a, b) => a - b).join('-');
    const rank = evaluateHand(combo);
    let skipCombo = false;
    if (snipes && Array.isArray(snipes)) {
      for (const s of snipes) {
        if (!s) continue;
        if (typeof s === 'string') {
          if (s === sortedStr) { skipCombo = true; break; }
        } else if (typeof s === 'object') {
          const cat = s.category;
          const val = s.value;
          if (cat && val) {
            if (rank[0] === cat && rank[1] === val) { skipCombo = true; break; }
          }
        }
      }
    }
    if (skipCombo) continue;
    if (compareRanks(rank, bestRank) > 0) { bestRank = rank; bestComboStr = sortedStr; }
  }
  return { rank: bestRank, comboStr: bestComboStr };
}

// ========================= Time Call (Countdown) =========================
function setupCountdown(game) {
  if (callTimerIntervalId) { clearInterval(callTimerIntervalId); callTimerIntervalId = null; }
  if (!game || game.timeCallStart === undefined || game.timeCallTarget === undefined) return;
  const startMs = game.timeCallStart;
  const targetId = game.timeCallTarget;
  const durationMs = game.timeCallDuration || 30000;
  if (!startMs || !targetId) return;
  function update() {
    const now = Date.now();
    const elapsed = now - startMs;
    const remainingMs = Math.max(durationMs - elapsed, 0);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const targetPlayer = (game.players || []).find(p => p.id === targetId);
    const name = targetPlayer ? targetPlayer.name : 'Player';
    if (remainingMs > 0) messageArea.textContent = `${name} has ${remainingSec} seconds to act.`;
    else {
      messageArea.textContent = `${name} ran out of time.`;
      clearInterval(callTimerIntervalId); callTimerIntervalId = null;
      handleTimeOut(game);
    }
  }
  update();
  callTimerIntervalId = setInterval(update, 1000);
}

async function handleTimeOut(game) {
  try {
    if (!game || !game.timeCallTarget) return;
    const docRef = doc(db, 'games', currentGameId);
    const snap = await getDoc(docRef);
    const current = snap.data();
    if (!current) return;
    const targetId = current.timeCallTarget;
    await updateDoc(docRef, { timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
    if (targetId !== myPlayerId) return;
    if (current.phase === 'sniping') {
      await submitSnipe('');
    } else if (['preflop','flop','turn'].includes(current.phase)) {
      const me = current.players.find(p => p.id === myPlayerId);
      if (!me) return;
      const diff = current.currentBet - (me.bet || 0);
      if (diff <= 0) await callAction(); else await foldAction();
    }
  } catch (err) { console.error('Error handling timeout:', err); }
}

async function callTimeAction() {
  try {
    const docRef = doc(db, 'games', currentGameId);
    const snap = await getDoc(docRef);
    const game = snap.data();
    if (!game) return;
    if (['showdown','finished'].includes(game.phase) || game.timeCallStart) return;
    let targetId = null;
    if (game.phase === 'sniping') {
      const target = game.players[game.snipingIndex];
      if (target) targetId = target.id;
    } else {
      const target = game.players[game.currentPlayerIndex];
      if (target) targetId = target.id;
    }
    if (!targetId || targetId === myPlayerId) return;
    await updateDoc(docRef, { timeCallStart: Date.now(), timeCallTarget: targetId, timeCallDuration: 30000 });
  } catch (err) { console.error('Error calling time:', err); }
}

// ========================= Lobby =========================
function renderLobby(game) {
  if (!game || !game.players) return;
  const names = game.players.map(p => p.name).join(', ');
  if (currentGameId) lobbyStatus.textContent = `Game ID: ${currentGameId} | Players: ${names}`;
  else lobbyStatus.textContent = `Players: ${names}`;
  const isHost = (game.creatorId === myPlayerId);
  let startBtn = document.getElementById('startGameBtn');
  if (isHost && game.players.length >= 2 && !game.started) {
    if (!startBtn) {
      startBtn = document.createElement('button');
      startBtn.id = 'startGameBtn';
      startBtn.textContent = 'Start Game';
      startBtn.onclick = async () => {
        if (!currentGameId) return;
        try {
          const ref = doc(db, 'games', currentGameId);
          const snap = await getDoc(ref);
          if (snap.exists()) await startHand(snap.data());
          else await startHand();
        } catch (err) { console.error('Error fetching game before start:', err); await startHand(); }
      };
    }
    if (startGameContainer) { startGameContainer.innerHTML = ''; startGameContainer.appendChild(startBtn); }
    else lobbyDiv.appendChild(startBtn);
  } else {
    if (startBtn) startBtn.remove();
    if (startGameContainer) startGameContainer.innerHTML = '';
  }
}

// ========================= Rendering (table UI) =========================
function renderGame(game) {
  if (!game) return;
  playerNameSpan.textContent = myName || '';
  phaseSpan.textContent = game.phase;
  potSpan.textContent = game.pot;
  const myPlayer = game.players.find(p => p.id === myPlayerId);
  if (myPlayer) playerChipsSpan.textContent = myPlayer.chips;

  // Call/Check label
  if (myPlayer) {
    const diffVal = game.currentBet - (myPlayer.bet || 0);
    callBtn.textContent = diffVal <= 0 ? 'Check' : 'Call';
  } else callBtn.textContent = 'Call';

  // Community cards
  communityCardsDiv.innerHTML = '';
  game.communityCards.forEach(v => {
    const el = document.createElement('div');
    el.className = 'card community-card';
    el.textContent = v;
    communityCardsDiv.appendChild(el);
  });
  const potCenterEl = document.getElementById('potCenter');
  if (potCenterEl) potCenterEl.textContent = `Pot: ${game.pot}`;

  // Seats
  const tableEl = document.getElementById('pokerTable');
  if (tableEl) {
    tableEl.querySelectorAll('.player-seat').forEach(n => n.remove());
    const positions = getSeatPositions(game.players.length);
    const nSeats = game.players.length;
    const myIndex = game.players.findIndex(p => p.id === myPlayerId);
    const shift = (nSeats - (myIndex >= 0 ? myIndex : 0)) % nSeats;

    game.players.forEach((p, idx) => {
      const seat = document.createElement('div');
      seat.className = 'player-seat';
      const seatIndex = (idx + shift) % nSeats;
      if (idx === game.currentPlayerIndex && !['sniping','showdown','finished'].includes(game.phase)) seat.classList.add('current-turn');
      if (p.folded) seat.classList.add('folded');
      if (p.eliminated) seat.classList.add('eliminated');
      const pos = positions[seatIndex];
      seat.style.left = pos.x + '%';
      seat.style.top = pos.y + '%';

      // Cards
      const cardsC = document.createElement('div');
      cardsC.className = 'cards';
      const show = (p.id === myPlayerId) || ((game.phase === 'showdown' || game.phase === 'finished') && !p.folded);
      if (p.hole && p.hole.length === 2) {
        p.hole.forEach(v => {
          const c = document.createElement('div');
          c.className = 'card';
          if (show) c.textContent = v; else c.classList.add('back');
          cardsC.appendChild(c);
        });
      } else {
        for (let j = 0; j < 2; j++) {
          const c = document.createElement('div'); c.className = 'card back'; cardsC.appendChild(c);
        }
      }
      seat.appendChild(cardsC);

      // Info bar
      const info = document.createElement('div'); info.className = 'player-info';
      const avatar = document.createElement('div'); avatar.className = 'avatar'; info.appendChild(avatar);
      const details = document.createElement('div'); details.className = 'details';
      const nameDiv = document.createElement('div'); nameDiv.className = 'name'; nameDiv.textContent = p.name;
      const chipsDiv = document.createElement('div'); chipsDiv.className = 'chips'; chipsDiv.textContent = `Chips: ${p.chips}`;
      details.appendChild(nameDiv); details.appendChild(chipsDiv); info.appendChild(details);
      seat.appendChild(info);

      // Bet chip
      if (p.bet && p.bet > 0) {
        const betDiv = document.createElement('div'); betDiv.className = 'bet';
        const chipIcon = document.createElement('span'); chipIcon.className = 'chip-icon'; betDiv.appendChild(chipIcon);
        const betVal = document.createElement('span'); betVal.textContent = p.bet; betVal.style.fontSize = '0.7rem'; betVal.style.color = '#ffd24a'; betDiv.appendChild(betVal);
        seat.appendChild(betDiv);
      }

      tableEl.appendChild(seat);
    });
  }

  // Default UI state
  messageArea.textContent = '';
  if (snipesDisplay) snipesDisplay.textContent = '';
  setupCountdown(game);

  callBtn.disabled = true; raiseBtn.disabled = true; foldBtn.disabled = true;
  raiseAmountInput.disabled = true; raiseAmountInput.style.display = 'none';
  if (confirmRaiseBtn) confirmRaiseBtn.style.display = 'none';
  if (cancelRaiseBtn) cancelRaiseBtn.style.display = 'none';
  raiseBtn.style.display = '';
  snipeBtn.style.display = 'none'; snipeInput.style.display = 'none';
  if (snipeComboSelect) snipeComboSelect.style.display = 'none';
  if (snipeHighSelect) snipeHighSelect.style.display = 'none';
  submitSnipeBtn.style.display = 'none';

  // Call time button visibility
  if (callTimeBtn) {
    callTimeBtn.style.display = 'none'; callTimeBtn.disabled = true;
    if (['preflop','flop','turn'].includes(game.phase)) {
      const acting = game.players[game.currentPlayerIndex];
      if (acting && acting.id !== myPlayerId && !acting.folded && !acting.eliminated) {
        callTimeBtn.style.display = ''; callTimeBtn.disabled = !!game.timeCallStart;
      }
    } else if (game.phase === 'sniping') {
      const acting = game.players[game.snipingIndex];
      if (acting && acting.id !== myPlayerId && !acting.folded && !acting.eliminated) {
        callTimeBtn.style.display = ''; callTimeBtn.disabled = !!game.timeCallStart;
      }
    }
  }

  // Enable actions on my turn (betting rounds)
  if (['preflop','flop','turn'].includes(game.phase)) {
    const acting = game.players[game.currentPlayerIndex];
    if (acting && acting.id === myPlayerId) {
      if (!myPlayer.folded) {
        callBtn.disabled = false;
        const diff = game.currentBet - (myPlayer.bet || 0);
        callBtn.textContent = diff <= 0 ? 'Check' : 'Call';
        raiseBtn.disabled = false;
        foldBtn.disabled = false;
        raiseBtn.onclick = () => {
          if (raiseBtn.disabled) return;
          raiseBtn.style.display = 'none';
          raiseAmountInput.style.display = ''; raiseAmountInput.disabled = false;
          if (confirmRaiseBtn) confirmRaiseBtn.style.display = '';
          if (cancelRaiseBtn) cancelRaiseBtn.style.display = '';
          const active = game.players.filter(p => !p.folded && !p.eliminated);
          if (active.length > 0) {
            const minChips = Math.min(...active.map(p => p.chips));
            raiseAmountInput.max = minChips;
            if (parseInt(raiseAmountInput.value) > minChips) raiseAmountInput.value = minChips;
          }
        };
        if (confirmRaiseBtn) confirmRaiseBtn.onclick = async () => {
          const amt = raiseAmountInput.value;
          raiseAmountInput.style.display = 'none'; raiseAmountInput.disabled = true;
          confirmRaiseBtn.style.display = 'none'; cancelRaiseBtn.style.display = 'none';
          raiseBtn.style.display = '';
          await raiseAction(amt);
        };
        if (cancelRaiseBtn) cancelRaiseBtn.onclick = () => {
          raiseAmountInput.style.display = 'none'; raiseAmountInput.disabled = true;
          if (confirmRaiseBtn) confirmRaiseBtn.style.display = 'none';
          if (cancelRaiseBtn) cancelRaiseBtn.style.display = 'none';
          raiseBtn.style.display = '';
        };
      }
    }
  } else if (game.phase === 'sniping') {
    if (game.snipes === undefined) game.snipes = [];
    if (snipesDisplay) {
      const arr = game.snipes || [];
      if (arr.length === 0) snipesDisplay.textContent = 'No snipes declared yet.';
      else {
        const lines = arr.map(s => {
          if (!s) return '';
          if (typeof s === 'string') return `5-card hand ${s}`;
          if (!s.category || !s.value || s.none) return `No snipe declared by ${s.name}`;
          let desc;
          switch (s.category) {
            case 7: desc = `Four of a Kind (${s.value})`; break;
            case 6: desc = `Full House (trip ${s.value})`; break;
            case 5: desc = `Straight to ${s.value}`; break;
            case 4: desc = `Three of a Kind (${s.value})`; break;
            case 3: desc = `Two Pair (highest ${s.value})`; break;
            case 2: desc = `Pair of ${s.value}s`; break;
            default: desc = `High Card ${s.value}`; break;
          }
          return `${desc} by ${s.name}`;
        }).filter(Boolean);
        if (lines.length > 0) snipesDisplay.innerHTML = '<strong>Declared snipes:</strong><br>' + lines.map(l => `<div>${l}</div>`).join('');
        else snipesDisplay.textContent = '';
      }
    }
    if (game.players[game.snipingIndex] && game.players[game.snipingIndex].id === myPlayerId) {
      snipeBtn.style.display = '';
      snipeBtn.onclick = () => {
        snipeBtn.style.display = 'none';
        if (snipeComboSelect) snipeComboSelect.style.display = '';
        if (snipeHighSelect) snipeHighSelect.style.display = '';
        submitSnipeBtn.style.display = '';
      };
      submitSnipeBtn.onclick = async () => {
        const catVal = snipeComboSelect ? snipeComboSelect.value : '';
        const highVal = snipeHighSelect ? snipeHighSelect.value : '';
        if (snipeComboSelect) snipeComboSelect.value = '';
        if (snipeHighSelect) snipeHighSelect.value = '';
        if (snipeComboSelect) snipeComboSelect.style.display = 'none';
        if (snipeHighSelect) snipeHighSelect.style.display = 'none';
        submitSnipeBtn.style.display = 'none';
        snipeBtn.style.display = '';
        if (catVal && highVal) await submitSnipe({ category: parseInt(catVal), value: parseInt(highVal) });
        else await submitSnipe('');
      };
    }
  } else if (['showdown','finished'].includes(game.phase)) {
    if (game.outcomeMessage) messageArea.textContent = game.outcomeMessage;
    if (game.creatorId === myPlayerId && !game.gameOver) {
      let nextBtn = document.getElementById('nextHandBtn');
      if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'nextHandBtn'; nextBtn.textContent = 'Next Hand';
        nextBtn.onclick = async () => {
          if (!currentGameId) return;
          try {
            const ref = doc(db, 'games', currentGameId); const snap = await getDoc(ref);
            if (snap.exists()) await startHand(snap.data()); else await startHand();
          } catch (err) { console.error('Error fetching game before next hand:', err); await startHand(); }
          nextBtn.remove();
        };
        messageArea.appendChild(nextBtn);
      }
    }
  }
}

// ========================= Firestore Sync =========================
async function subscribeToGame(gameId) {
  if (unsubscribe) unsubscribe();
  const docRef = doc(db, 'games', gameId);
  unsubscribe = onSnapshot(docRef, (snapshot) => {
    const game = snapshot.data();
    if (!game) { messageArea.textContent = 'Game no longer exists.'; return; }
    if (!currentGameId) currentGameId = snapshot.id;
    if (!game.started) renderLobby(game);
    else { lobbyDiv.style.display = 'none'; gameDiv.style.display = ''; renderGame(game); }
  });
}

// ========================= Game Flow =========================
async function startHand(game) {
  if (!db) return;
  let localGame = game;
  if (currentGameId) {
    try { const ref = doc(db, 'games', currentGameId); const snap = await getDoc(ref); if (snap.exists()) localGame = snap.data(); }
    catch (err) { console.error('Error fetching game for startHand:', err); }
  }
  if (!localGame || localGame.gameOver) return;
  const docRef = doc(db, 'games', currentGameId);
  game = localGame;

  let dealerIndex = game.dealerIndex || 0;
  if (game.handNumber > 0) dealerIndex = nextActiveIndex(game.players, dealerIndex);

  // Determine who can play (chips > 0 and not eliminated)
  const eligiblePlayers = game.players.filter(p => !p.eliminated && p.chips > 0);
  if (eligiblePlayers.length < 2) {
    const winner = eligiblePlayers.length === 1 ? eligiblePlayers[0] : game.players.find(p => !p.eliminated) || game.players[0];
    await updateDoc(docRef, { gameOver: true, outcomeMessage: `${winner.name} wins the game!` });
    return;
  }

  // Build deck (1-10, four copies each)
  const deck = []; for (let i = 1; i <= 10; i++) for (let j = 0; j < 4; j++) deck.push(i);
  shuffle(deck);

  // Reset players for the new hand
  const players = game.players.map(p => {
    const n = { ...p };
    if (n.eliminated || n.chips <= 0) {
      n.eliminated = true; n.hole = []; n.bet = 0; n.folded = true;
    } else {
      n.hole = [deck.pop(), deck.pop()]; n.bet = 0; n.folded = false;
    }
    n.hasActed = false; return n;
  });

  // Blinds
  let smallBlindIdx = nextActiveIndex(players, dealerIndex);
  let bigBlindIdx = nextActiveIndex(players, smallBlindIdx);
  let pot = 0; let currentBet = 0;
  const sbAmount = game.smallBlind || 1; const bbAmount = game.bigBlind || 2;
  const sbPlayer = players[smallBlindIdx]; const bbPlayer = players[bigBlindIdx];
  const sbPay = Math.min(sbAmount, sbPlayer.chips); sbPlayer.chips -= sbPay; sbPlayer.bet = sbPay; pot += sbPay;
  const bbPay = Math.min(bbAmount, bbPlayer.chips); bbPlayer.chips -= bbPay; bbPlayer.bet = bbPay; pot += bbPay;
  currentBet = Math.max(sbPay, bbPay);
  players.forEach(p => p.hasActed = false);
  sbPlayer.hasActed = false; bbPlayer.hasActed = false;
  let lastAggressivePlayerIndex = bigBlindIdx;
  let currentPlayerIndex = nextActiveIndex(players, bigBlindIdx);

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
    handTotalChips: players.reduce((sum, p) => sum + p.chips, 0) + pot,
    // clear any lingering time call state
    timeCallStart: null,
    timeCallTarget: null,
    timeCallDuration: null,
  };
  await updateDoc(docRef, update);
}

async function callAction() {
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef); const game = snap.data();
  const idx = game.currentPlayerIndex; const player = game.players[idx];
  if (player.id !== myPlayerId || player.folded) return;
  const diff = game.currentBet - player.bet; const pay = Math.min(diff, player.chips);
  player.chips -= pay; player.bet += pay; game.players[idx] = player;
  if (game.handTotalChips) { const chipsSum = game.players.reduce((s,p)=>s+p.chips,0); game.pot = game.handTotalChips - chipsSum; }
  else { game.pot += pay; }
  player.hasActed = true;

  const nextIdx = nextActiveIndex(game.players, idx);
  const activePlayers = game.players.filter(p => !p.folded && !p.eliminated);
  const allActed = activePlayers.every(p => p.hasActed);
  if (allActed) {
    await updateDoc(docRef, { players: game.players, pot: game.pot, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
    await advanceRound(game);
  } else {
    await updateDoc(docRef, { players: game.players, pot: game.pot, currentPlayerIndex: nextIdx, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
  }
}

async function raiseAction(amount) {
  const raiseAmount = parseInt(amount);
  if (isNaN(raiseAmount) || raiseAmount <= 0) { messageArea.textContent = 'Invalid raise amount.'; return; }
  const gameSnap = await getDoc(doc(doc(db, 'games'), currentGameId));
  const currentGame = gameSnap.data();
  const activePlayers = currentGame.players.filter(p => !p.folded && !p.eliminated);
  if (activePlayers.length > 0) {
    const minChips = Math.min(...activePlayers.map(p => p.chips));
    if (raiseAmount > minChips) { messageArea.textContent = `Raise amount exceeds the maximum allowed (${minChips}).`; return; }
  }
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef); const game = snap.data();
  const idx = game.currentPlayerIndex; const player = game.players[idx];
  if (player.id !== myPlayerId || player.folded) return;
  const newBet = game.currentBet + raiseAmount; const diff = newBet - player.bet; const pay = Math.min(diff, player.chips);
  player.chips -= pay; player.bet += pay; game.players[idx] = player;
  if (game.handTotalChips) { const chipsSum = game.players.reduce((s,p)=>s+p.chips,0); game.pot = game.handTotalChips - chipsSum; } else { game.pot += pay; }
  game.currentBet = newBet; game.lastAggressivePlayerIndex = idx;
  game.players.forEach(p => { if (!p.folded && !p.eliminated) p.hasActed = (p.id === player.id); });
  const nextIdx = nextActiveIndex(game.players, idx);
  await updateDoc(docRef, { players: game.players, pot: game.pot, currentBet: game.currentBet, lastAggressivePlayerIndex: game.lastAggressivePlayerIndex, currentPlayerIndex: nextIdx, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
}

async function foldAction() {
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef); const game = snap.data();
  const idx = game.currentPlayerIndex; const player = game.players[idx];
  if (player.id !== myPlayerId) return;
  player.folded = true; player.hasActed = true;

  const activeIndices = [];
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i]; if (!p.folded && !p.eliminated) activeIndices.push(i);
  }
  if (activeIndices.length === 1) {
    const winnerIdx = activeIndices[0]; const potAmount = game.pot;
    game.players[winnerIdx].chips += potAmount; game.pot = 0; game.phase = 'finished';
    game.outcomeMessage = `${game.players[winnerIdx].name} wins ${potAmount} chips (all others folded)`;
    await updateDoc(docRef, { players: game.players, pot: game.pot, phase: game.phase, outcomeMessage: game.outcomeMessage, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
    return;
  }
  const nextIdx = nextActiveIndex(game.players, idx);
  if (idx === game.lastAggressivePlayerIndex) {
    let prev = idx;
    do { prev = (prev - 1 + game.players.length) % game.players.length; if (!game.players[prev].folded && !game.players[prev].eliminated) break; } while (true);
    game.lastAggressivePlayerIndex = prev;
  }
  game.players[idx] = player;
  const activePlayers = game.players.filter(p => !p.folded && !p.eliminated);
  const allActed = activePlayers.every(p => p.hasActed);
  if (allActed) await advanceRound(game);
  else await updateDoc(docRef, { players: game.players, currentPlayerIndex: nextIdx, lastAggressivePlayerIndex: game.lastAggressivePlayerIndex, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
}

async function advanceRound(game) {
  const docRef = doc(db, 'games', currentGameId);
  game.players.forEach(p => { p.bet = 0; p.hasActed = false; });
  if (game.bettingRound === 0) {
    const deck = game.deck; const c1 = deck.pop(); const c2 = deck.pop();
    game.communityCards.push(c1, c2); game.bettingRound = 1; game.phase = 'flop'; game.currentBet = 0;
    const firstToAct = nextActiveIndex(game.players, game.dealerIndex);
    game.lastAggressivePlayerIndex = firstToAct; game.currentPlayerIndex = firstToAct;
    await updateDoc(docRef, { players: game.players, communityCards: game.communityCards, deck, bettingRound: game.bettingRound, phase: game.phase, currentBet: game.currentBet, lastAggressivePlayerIndex: game.lastAggressivePlayerIndex, currentPlayerIndex: game.currentPlayerIndex, pot: game.pot, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
  } else if (game.bettingRound === 1) {
    const deck = game.deck; const c3 = deck.pop(); const c4 = deck.pop();
    game.communityCards.push(c3, c4); game.bettingRound = 2; game.phase = 'turn'; game.currentBet = 0;
    const firstToAct = nextActiveIndex(game.players, game.dealerIndex);
    game.lastAggressivePlayerIndex = firstToAct; game.currentPlayerIndex = firstToAct;
    await updateDoc(docRef, { players: game.players, communityCards: game.communityCards, deck, bettingRound: game.bettingRound, phase: game.phase, currentBet: game.currentBet, lastAggressivePlayerIndex: game.lastAggressivePlayerIndex, currentPlayerIndex: game.currentPlayerIndex, pot: game.pot, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
  } else if (game.bettingRound === 2) {
    game.phase = 'sniping';
    game.snipingStartIndex = game.lastAggressivePlayerIndex;
    game.snipingIndex = game.lastAggressivePlayerIndex;
    await updateDoc(docRef, { players: game.players, phase: game.phase, snipingStartIndex: game.snipingStartIndex, snipingIndex: game.snipingIndex, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
  }
}

async function submitSnipe(value) {
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef); const game = snap.data();
  if (game.phase !== 'sniping') return;
  if (!Array.isArray(game.snipes)) game.snipes = [];
  const idx = game.snipingIndex; const player = game.players[idx];
  if (player.id !== myPlayerId) return;
  const snipeVal = (value === '' || value === null || value === undefined)
    ? { none: true, name: player.name }
    : (typeof value === 'object' ? { ...value, name: player.name } : value);

  game.snipes[idx] = snipeVal;

  // move to next snipe
  let nextIdx = idx;
  const n = game.players.length;
  for (let step = 0; step < n - 1; step++) {
    nextIdx = (nextIdx + 1) % n;
    const p = game.players[nextIdx];
    if (!p.folded && !p.eliminated) break;
  }
  if (nextIdx === game.snipingStartIndex) {
    // Sniping complete -> showdown
    await updateDoc(docRef, { snipes: game.snipes, phase: 'showdown', timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
    await resolveShowdown();
  } else {
    await updateDoc(docRef, { snipes: game.snipes, snipingIndex: nextIdx, timeCallStart: null, timeCallTarget: null, timeCallDuration: null });
  }
}

async function resolveShowdown() {
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef); const game = snap.data();
  const active = game.players.map((p, i) => ({...p, index: i})).filter(p => !p.folded && !p.eliminated);
  let bestRank = [0]; let winners = [];
  for (const p of active) {
    const { rank } = bestHandForPlayer(p, game.communityCards, game.snipes);
    if (compareRanks(rank, bestRank) > 0) { bestRank = rank; winners = [p.index]; }
    else if (compareRanks(rank, bestRank) === 0) winners.push(p.index);
  }
  let outcome = '';
  if (winners.length === 0) {
    // Edge case: all sniped out -> split pot among active players equally
    const share = Math.floor(game.pot / active.length);
    active.forEach(p => { game.players[p.index].chips += share; });
    outcome = `Pot ${game.pot} split among ${active.length} players (all best hands sniped).`;
    game.pot = 0;
  } else if (winners.length === 1) {
    const w = winners[0]; game.players[w].chips += game.pot; outcome = `${game.players[w].name} wins ${game.pot} chips!`; game.pot = 0;
  } else {
    // Split equally between winners (round down), leave remainder in pot=0 (house burns remainder)
    const share = Math.floor(game.pot / winners.length);
    winners.forEach(i => { game.players[i].chips += share; });
    outcome = `Pot split: ${winners.map(i => game.players[i].name).join(', ')} each get ${share}.`;
    game.pot = 0;
  }

  // Eliminate anyone who has 0 chips
  game.players.forEach(p => { if (p.chips <= 0) { p.chips = 0; p.eliminated = true; p.folded = true; } });

  // Check last-person-standing victory
  const stillIn = game.players.filter(p => !p.eliminated && p.chips > 0);
  let finalUpdate = { players: game.players, pot: game.pot, phase: 'finished', outcomeMessage: outcome };
  if (stillIn.length < 2) {
    const champ = stillIn.length === 1 ? stillIn[0] : game.players.find(p => !p.eliminated) || game.players[0];
    finalUpdate.gameOver = true;
    finalUpdate.outcomeMessage = `${outcome}  ${champ.name} wins the game!`;
  }
  await updateDoc(docRef, finalUpdate);
}

// ========================= Create / Join =========================
createGameBtn?.addEventListener('click', async () => {
  if (!db) return;
  myName = (nameInput.value || '').trim() || 'Player';
  myPlayerId = crypto.randomUUID();
  const gameId = generateGameCode();
  currentGameId = gameId;
  const ref = doc(db, 'games', gameId);
  const gameDoc = {
    creatorId: myPlayerId,
    createdAt: serverTimestamp(),
    started: false,
    gameOver: false,
    handNumber: 0,
    smallBlind: 1,
    bigBlind: 2,
    dealerIndex: 0,
    players: [
      { id: myPlayerId, name: myName, chips: 60, bet: 0, folded: false, eliminated: false, hole: [], hasActed: false },
    ],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    outcomeMessage: '',
    timeCallStart: null,
    timeCallTarget: null,
    timeCallDuration: null,
  };
  await setDoc(ref, gameDoc);
  lobbyDiv.style.display = '';
  gameDiv.style.display = 'none';
  subscribeToGame(gameId);
});

joinGameBtn?.addEventListener('click', async () => {
  if (!db) return;
  myName = (nameInput.value || '').trim() || 'Player';
  myPlayerId = crypto.randomUUID();
  const gameId = (gameIdInput.value || '').trim().toUpperCase();
  if (!gameId) { lobbyStatus.textContent = 'Enter a game ID to join.'; return; }
  const ref = doc(db, 'games', gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) { lobbyStatus.textContent = 'Game not found.'; return; }
  const game = snap.data();
  if (game.started && game.handNumber > 0) { lobbyStatus.textContent = 'Game already started.'; return; }
  const exists = game.players.some(p => p.name.toLowerCase() === myName.toLowerCase());
  if (exists) { lobbyStatus.textContent = 'Name already taken in this game.'; return; }
  game.players.push({ id: myPlayerId, name: myName, chips: 60, bet: 0, folded: false, eliminated: false, hole: [], hasActed: false });
  await updateDoc(ref, { players: game.players });
  currentGameId = gameId;
  subscribeToGame(gameId);
});

// Action buttons
callBtn?.addEventListener('click', callAction);
foldBtn?.addEventListener('click', foldAction);
raiseBtn?.addEventListener('click', () => {/* real handler is set on render to use fresh game */});
confirmRaiseBtn?.addEventListener('click', () => {/* set on render */});
cancelRaiseBtn?.addEventListener('click', () => {/* set on render */});
snipeBtn?.addEventListener('click', () => {/* set on render */});
submitSnipeBtn?.addEventListener('click', () => {/* set on render */});
callTimeBtn?.addEventListener('click', callTimeAction);

// Expose for debugging
window.__sniper = { startHand, callAction, raiseAction, foldAction, submitSnipe, resolveShowdown };
