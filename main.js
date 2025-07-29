/*
 * Sniper Hold'em client logic (merged fixes)
 *
 * This file consolidates all of the improvements made during debugging. It
 * replaces the previous `main (4).js` with a clean filename and includes:
 *   - Correct fold handling to ensure the right player wins when others fold.
 *   - Updated betting logic using `hasActed` to prevent extra turns when no
 *     raise occurs.
 *   - A dynamic "Check"/"Call" label on the call button.
 *   - Display of all players’ hole cards at showdown.
 *   - Persistent display of the game ID and players list in the lobby.
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

// Firebase configuration (replace with your project config)
const firebaseConfig = {
  apiKey: "AIzaSyA7sQscjjawGtWwTLO8S7OMPjWywVRaYfs",
  authDomain: "sniper-hold-em.firebaseapp.com",
  projectId: "sniper-hold-em",
  storageBucket: "sniper-hold-em.firebasestorage.app",
  messagingSenderId: "467999048041",
  appId: "1:467999048041:web:197d1877c0037536cd3df8"
};

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
const snipeComboSelect = document.getElementById('snipeComboSelect');
const snipeHighSelect = document.getElementById('snipeHighSelect');
const snipesDisplay = document.getElementById('snipesDisplay');

// New controls for confirming or cancelling a raise
const confirmRaiseBtn = document.getElementById('confirmRaiseBtn');
const cancelRaiseBtn = document.getElementById('cancelRaiseBtn');

// Current user and game identifiers
let myPlayerId = null;
let myName = null;
let currentGameId = null;
let unsubscribe = null;

// Utility: generate a random 5-character game code
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

// Utility: compute next active player's index
function nextActiveIndex(players, startIndex) {
  if (!players || players.length === 0) return 0;
  let idx = startIndex;
  do {
    idx = (idx + 1) % players.length;
    const p = players[idx];
    if (!p.eliminated && p.chips > 0 && !p.folded) {
      return idx;
    }
  } while (idx !== startIndex);
  return startIndex;
}

// Compute positions for player seats around the table.
// Returns an array of objects with `x` and `y` properties representing
// percentage offsets from the center of the table container.  The oval
// table uses different radii for the x and y axes to create an ellipse.
function getSeatPositions(num) {
  const positions = [];
  if (num <= 0) return positions;
  const angleOffset = -90; // Start from the top of the circle
  const xRadius = 45;      // Horizontal radius (percentage of container)
  const yRadius = 35;      // Vertical radius (percentage of container)
  for (let i = 0; i < num; i++) {
    const angle = (angleOffset + (360 / num) * i) * Math.PI / 180;
    const x = 50 + xRadius * Math.cos(angle);
    const y = 50 + yRadius * Math.sin(angle);
    positions.push({ x, y });
  }
  return positions;
}

// Utility: evaluate the rank of a 5‑card hand
function evaluateHand(cards) {
  const counts = {};
  for (const c of cards) {
    counts[c] = (counts[c] || 0) + 1;
  }
  const values = Object.keys(counts).map(n => parseInt(n));
  values.sort((a, b) => b - a);
  const countArr = values.map(v => counts[v]);
  const sorted = values.slice().sort((a, b) => {
    if (counts[b] === counts[a]) return b - a;
    return counts[b] - counts[a];
  });
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
  let rankCategory;
  if (countArr.includes(4)) {
    rankCategory = 7;
  } else if (countArr.includes(3) && countArr.includes(2)) {
    rankCategory = 6;
  } else if (isStraight) {
    rankCategory = 5;
  } else if (countArr.includes(3)) {
    rankCategory = 4;
  } else if (countArr.filter(c => c === 2).length === 2) {
    rankCategory = 3;
  } else if (countArr.includes(2)) {
    rankCategory = 2;
  } else {
    rankCategory = 1;
  }
  const tieBreakers = [];
  if (rankCategory === 7) {
    const quadVal = sorted.find(v => counts[v] === 4);
    const kicker = sorted.find(v => counts[v] === 1);
    tieBreakers.push(quadVal, kicker);
  } else if (rankCategory === 6) {
    const trip = sorted.find(v => counts[v] === 3);
    const pair = sorted.find(v => counts[v] === 2);
    tieBreakers.push(trip, pair);
  } else if (rankCategory === 5) {
    const highest = Math.max(...cards);
    tieBreakers.push(highest);
  } else if (rankCategory === 4) {
    const tripVal = sorted.find(v => counts[v] === 3);
    const kickers = sorted.filter(v => counts[v] === 1);
    tieBreakers.push(tripVal, ...kickers.slice(0, 2));
  } else if (rankCategory === 3) {
    const pairs = sorted.filter(v => counts[v] === 2);
    const kicker = sorted.find(v => counts[v] === 1);
    tieBreakers.push(pairs[0], pairs[1], kicker);
  } else if (rankCategory === 2) {
    const pair = sorted.find(v => counts[v] === 2);
    const kickers = sorted.filter(v => counts[v] === 1);
    tieBreakers.push(pair, ...kickers.slice(0, 3));
  } else {
    const sortedVals = cards.slice().sort((a, b) => b - a);
    tieBreakers.push(...sortedVals);
  }
  return [rankCategory, ...tieBreakers];
}

// Compare two ranking arrays
function compareRanks(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Determine the best non‑sniped 5‑card hand for a player
function bestHandForPlayer(player, communityCards, snipes) {
  const cards = [...player.hole, ...communityCards];
  const combinations = [];
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
    const rank = evaluateHand(combo);
    let skipCombo = false;
    if (snipes && Array.isArray(snipes)) {
      for (const s of snipes) {
        if (!s) continue;
        if (typeof s === 'string') {
          if (s === sortedStr) {
            skipCombo = true;
            break;
          }
        } else if (typeof s === 'object') {
          const cat = s.category;
          const val = s.value;
          if (cat && val) {
            if (rank[0] === cat && rank[1] === val) {
              skipCombo = true;
              break;
            }
          }
        }
      }
    }
    if (skipCombo) continue;
    if (compareRanks(rank, bestRank) > 0) {
      bestRank = rank;
      bestComboStr = sortedStr;
    }
  }
  return { rank: bestRank, comboStr: bestComboStr };
}

// Render lobby UI
function renderLobby(game) {
  if (!game || !game.players) return;
  const names = game.players.map(p => p.name).join(', ');
  // Show the game ID along with players. Use the global currentGameId if available.
  if (currentGameId) {
    lobbyStatus.textContent = `Game ID: ${currentGameId} | Players: ${names}`;
  } else {
    lobbyStatus.textContent = `Players: ${names}`;
  }
  const isHost = (game.creatorId === myPlayerId);
  let startBtn = document.getElementById('startGameBtn');
  if (isHost && game.players.length >= 2 && !game.started) {
    if (!startBtn) {
      startBtn = document.createElement('button');
      startBtn.id = 'startGameBtn';
      startBtn.textContent = 'Start Game';
      startBtn.onclick = async () => {
        // Before starting the hand, fetch the latest game data from
        // Firestore to avoid using a stale snapshot.  Only proceed if we
        // have a valid game ID; otherwise there's no document to fetch.
        if (!currentGameId) {
          console.warn('No currentGameId set when starting the game.');
          return;
        }
        try {
          const ref = doc(db, 'games', currentGameId);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            await startHand(snap.data());
          } else {
            // Fallback: if the document does not exist, call startHand() with
            // no argument so it can decide how to proceed.
            await startHand();
          }
        } catch (err) {
          console.error('Error fetching game before start:', err);
          // Attempt to start with whatever context startHand can obtain.
          await startHand();
        }
      };
      lobbyDiv.appendChild(startBtn);
    }
  } else {
    if (startBtn) startBtn.remove();
  }
}

// Render game UI
function renderGame(game) {
  if (!game) return;
  playerNameSpan.textContent = myName;
  phaseSpan.textContent = game.phase;
  potSpan.textContent = game.pot;
  const myPlayer = game.players.find(p => p.id === myPlayerId);
  if (myPlayer) {
    playerChipsSpan.textContent = myPlayer.chips;
  }
  // Update call/check button label based on my bet relative to currentBet
  if (myPlayer) {
    const diffVal = game.currentBet - (myPlayer.bet || 0);
    if (diffVal <= 0) {
      callBtn.textContent = 'Check';
    } else {
      callBtn.textContent = 'Call';
    }
  } else {
    callBtn.textContent = 'Call';
  }
  // Render community cards in the table center.
  communityCardsDiv.innerHTML = '';
  game.communityCards.forEach(val => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.textContent = val;
    // Apply community-card styling for central cards
    cardEl.classList.add('community-card');
    communityCardsDiv.appendChild(cardEl);
  });
  // Clear hole cards display (no longer used in new layout)
  holeCardsDiv.innerHTML = '';
  // Render player seats around the poker table
  const tableEl = document.getElementById('pokerTable');
  const oldSeats = tableEl.querySelectorAll('.player-seat');
  oldSeats.forEach(el => el.remove());
  const positions = getSeatPositions(game.players.length);
  game.players.forEach((p, idx) => {
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    if (idx === game.currentPlayerIndex && game.phase !== 'sniping' && game.phase !== 'showdown' && game.phase !== 'finished') {
      seat.classList.add('current-turn');
    }
    if (p.folded) seat.classList.add('folded');
    if (p.eliminated) seat.classList.add('eliminated');
    const pos = positions[idx];
    seat.style.left = pos.x + '%';
    seat.style.top = pos.y + '%';
    // Cards container
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards';
    const showCards = (p.id === myPlayerId) || ((game.phase === 'showdown' || game.phase === 'finished') && !p.folded);
    if (p.hole && p.hole.length === 2) {
      p.hole.forEach(val2 => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        if (showCards) {
          cardDiv.textContent = val2;
        } else {
          cardDiv.classList.add('back');
        }
        cardsContainer.appendChild(cardDiv);
      });
    } else {
      for (let j = 0; j < 2; j++) {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card back';
        cardsContainer.appendChild(cardDiv);
      }
    }
    seat.appendChild(cardsContainer);
    // Player info
    const infoDiv = document.createElement('div');
    infoDiv.className = 'player-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'name';
    nameDiv.textContent = p.name;
    const chipsDiv = document.createElement('div');
    chipsDiv.className = 'chips';
    chipsDiv.textContent = `Chips: ${p.chips}`;
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(chipsDiv);
    seat.appendChild(infoDiv);
    // Bet display
    if (p.bet && p.bet > 0) {
      const betDiv = document.createElement('div');
      betDiv.className = 'bet';
      const chipIcon = document.createElement('span');
      chipIcon.className = 'chip-icon';
      betDiv.appendChild(chipIcon);
      const betVal = document.createElement('span');
      betVal.textContent = p.bet;
      betDiv.appendChild(betVal);
      seat.appendChild(betDiv);
    }
    tableEl.appendChild(seat);
  });
  messageArea.textContent = '';
  if (snipesDisplay) snipesDisplay.textContent = '';
  callBtn.disabled = true;
  raiseBtn.disabled = true;
  // Hide and disable the raise controls by default. These will be
  // re-enabled and displayed when it is the player's turn and they click Raise.
  raiseAmountInput.disabled = true;
  raiseAmountInput.style.display = 'none';
  if (confirmRaiseBtn) confirmRaiseBtn.style.display = 'none';
  if (cancelRaiseBtn) cancelRaiseBtn.style.display = 'none';
  raiseBtn.style.display = '';
  foldBtn.disabled = true;
  snipeBtn.style.display = 'none';
  snipeInput.style.display = 'none';
  if (snipeComboSelect) snipeComboSelect.style.display = 'none';
  if (snipeHighSelect) snipeHighSelect.style.display = 'none';
  submitSnipeBtn.style.display = 'none';
  if (game.phase === 'preflop' || game.phase === 'flop' || game.phase === 'turn') {
    if (game.players[game.currentPlayerIndex] && game.players[game.currentPlayerIndex].id === myPlayerId) {
      if (!myPlayer.folded) {
        callBtn.disabled = false;
        if (myPlayer) {
          const diff = game.currentBet - (myPlayer.bet || 0);
          if (diff <= 0) {
            callBtn.textContent = 'Check';
          } else {
            callBtn.textContent = 'Call';
          }
        }
        // Enable raise button and fold button on your turn. The raise amount
        // input remains hidden until Raise is clicked.
        raiseBtn.disabled = false;
        foldBtn.disabled = false;
        // Attach click handlers to manage the raise sequence. These
        // handlers are recreated on each render to ensure fresh closures.
        raiseBtn.onclick = () => {
          if (raiseBtn.disabled) return;
          // Hide the raise button and show the input and confirm/cancel buttons
          raiseBtn.style.display = 'none';
          raiseAmountInput.style.display = '';
          raiseAmountInput.disabled = false;
          if (confirmRaiseBtn) confirmRaiseBtn.style.display = '';
          if (cancelRaiseBtn) cancelRaiseBtn.style.display = '';
          // Update the maximum raise based on remaining chips
          const active = game.players.filter(p => !p.folded && !p.eliminated);
          if (active.length > 0) {
            const minChips = Math.min(...active.map(p => p.chips));
            raiseAmountInput.max = minChips;
            if (parseInt(raiseAmountInput.value) > minChips) {
              raiseAmountInput.value = minChips;
            }
          }
        };
        if (confirmRaiseBtn) {
          confirmRaiseBtn.onclick = async () => {
            // Perform the raise with the entered amount
            const amt = raiseAmountInput.value;
            // Hide controls immediately to prevent multiple submissions
            raiseAmountInput.style.display = 'none';
            raiseAmountInput.disabled = true;
            confirmRaiseBtn.style.display = 'none';
            cancelRaiseBtn.style.display = 'none';
            raiseBtn.style.display = '';
            await raiseAction(amt);
          };
        }
        if (cancelRaiseBtn) {
          cancelRaiseBtn.onclick = () => {
            // Reset and hide raise input without taking any action
            raiseAmountInput.style.display = 'none';
            raiseAmountInput.disabled = true;
            if (confirmRaiseBtn) confirmRaiseBtn.style.display = 'none';
            if (cancelRaiseBtn) cancelRaiseBtn.style.display = 'none';
            raiseBtn.style.display = '';
          };
        }
      }
    }
  } else if (game.phase === 'sniping') {
    if (game.snipes === undefined) game.snipes = [];
    if (snipesDisplay) {
      const snipesArr = game.snipes || [];
      if (snipesArr.length === 0) {
        snipesDisplay.textContent = 'No snipes declared yet.';
      } else {
        const descriptions = snipesArr.map(s => {
          if (typeof s === 'string') {
            return `5-card hand ${s}`;
          }
          const cat = s.category;
          const val = s.value;
          let desc;
          switch (cat) {
            case 7:
              desc = `Four of a Kind (${val})`;
              break;
            case 6:
              desc = `Full House (trip ${val})`;
              break;
            case 5:
              desc = `Straight to ${val}`;
              break;
            case 4:
              desc = `Three of a Kind (${val})`;
              break;
            case 3:
              desc = `Two Pair (highest ${val})`;
              break;
            case 2:
              desc = `Pair of ${val}s`;
              break;
            default:
              desc = `High Card ${val}`;
              break;
          }
          return `${desc} by ${s.name}`;
        });
        snipesDisplay.textContent = 'Declared snipes: ' + descriptions.join(', ');
      }
    }
    if (game.snipingIndex !== undefined && game.players[game.snipingIndex] && game.players[game.snipingIndex].id === myPlayerId) {
      snipeBtn.style.display = '';
      snipeInput.style.display = 'none';
      if (snipeComboSelect) snipeComboSelect.style.display = 'none';
      if (snipeHighSelect) snipeHighSelect.style.display = 'none';
      submitSnipeBtn.style.display = 'none';
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
        if (catVal && highVal) {
          await submitSnipe({ category: parseInt(catVal), value: parseInt(highVal) });
        } else {
          await submitSnipe('');
        }
      };
    }
  } else if (game.phase === 'showdown' || game.phase === 'finished') {
    if (game.outcomeMessage) {
      messageArea.textContent = game.outcomeMessage;
    }
    if (game.creatorId === myPlayerId && !game.gameOver) {
      let nextBtn = document.getElementById('nextHandBtn');
      if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'nextHandBtn';
        nextBtn.textContent = 'Next Hand';
        nextBtn.onclick = async () => {
          // Before starting the next hand, fetch the latest game state.  As
          // with the lobby start button, ensure the currentGameId is set
          // and handle errors gracefully.
          if (!currentGameId) {
            console.warn('No currentGameId set when starting the next hand.');
            return;
          }
          try {
            const ref = doc(db, 'games', currentGameId);
            const snap = await getDoc(ref);
            if (snap.exists()) {
              await startHand(snap.data());
            } else {
              await startHand();
            }
          } catch (err) {
            console.error('Error fetching game before next hand:', err);
            await startHand();
          }
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
    // Ensure currentGameId is set from the snapshot ID so that the lobby can
    // always display the correct game code. This handles cases where the
    // global variable wasn’t set before subscribing.
    if (!currentGameId) {
      currentGameId = snapshot.id;
    }
    if (!game.started) {
      renderLobby(game);
    } else {
      lobbyDiv.style.display = 'none';
      gameDiv.style.display = '';
      renderGame(game);
    }
  });
}

// Host: start a new hand
async function startHand(game) {
  if (!db) return;
  // Use the provided game object as a fallback.  We'll attempt to fetch
  // a fresh copy from Firestore if a currentGameId is available.  If the
  // fetch succeeds, it replaces the local copy; otherwise we continue
  // with the passed-in data.
  let localGame = game;
  if (currentGameId) {
    try {
      const ref = doc(db, 'games', currentGameId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        localGame = snap.data();
      }
    } catch (err) {
      console.error('Error fetching game for startHand:', err);
    }
  }
  // If we still don't have a game or it's already over, abort the hand start.
  if (!localGame || localGame.gameOver) return;
  const docRef = doc(db, 'games', currentGameId);

  // From here on, operate on the up‑to‑date game data.  Assign back to the
  // function parameter so that the remainder of this function can refer to
  // `game` transparently.
  game = localGame;
  let dealerIndex = game.dealerIndex || 0;
  if (game.handNumber > 0) {
    dealerIndex = nextActiveIndex(game.players, dealerIndex);
  }
  // Determine which players are eligible to participate in the new hand.
  // A player is eligible if they still have chips and have not been eliminated.
  // Note that a player's `folded` state from the previous hand should not
  // prevent them from being considered here – everyone with chips gets a chance
  // to play the next hand.
  const eligiblePlayers = game.players.filter(p => !p.eliminated && p.chips > 0);
  if (eligiblePlayers.length < 2) {
    // If fewer than two players remain with chips, the game is over.  Award
    // the victory to the remaining player (or anyone not eliminated if no
    // one has chips) and halt further hand starts.
    const winner = eligiblePlayers.length === 1 ? eligiblePlayers[0] : game.players.find(p => !p.eliminated);
    await updateDoc(docRef, { gameOver: true, outcomeMessage: `${winner.name} wins the game!` });
    return;
  }
  const deck = [];
  for (let i = 1; i <= 10; i++) {
    for (let j = 0; j < 4; j++) {
      deck.push(i);
    }
  }
  shuffle(deck);
  // Reset all players for the new hand.  Players who still have chips receive
  // fresh hole cards and have their folded status cleared.  Eliminated
  // players remain folded with no cards.  Every player's hasActed flag is
  // cleared so the betting round proceeds correctly.
  const players = game.players.map((p) => {
    const newP = { ...p };
    if (newP.eliminated || newP.chips <= 0) {
      // Eliminated players do not participate in the hand.  They keep
      // their eliminated status, are marked as folded and receive no cards.
      newP.eliminated = true;
      newP.hole = [];
      newP.bet = 0;
      newP.folded = true;
    } else {
      // Active players receive fresh cards and are reset to un‑folded.
      newP.hole = [deck.pop(), deck.pop()];
      newP.bet = 0;
      newP.folded = false;
    }
    // In either case, reset the hasActed flag so the betting round starts
    // cleanly.  This is important so that players who were marked as
    // having acted in a previous hand (for example, those who joined
    // mid‑hand) will be able to act in this hand.
    newP.hasActed = false;
    return newP;
  });
  let smallBlindIdx = nextActiveIndex(players, dealerIndex);
  let bigBlindIdx = nextActiveIndex(players, smallBlindIdx);
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
  players.forEach(p => p.hasActed = false);
  sbPlayer.hasActed = false;
  bbPlayer.hasActed = false;
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
    // Track the total chips plus pot at the start of the hand so that the
    // pot can be recomputed from chip differences. After posting blinds,
    // players.reduce(chips,0) + pot equals the total chips each player
    // started the hand with (e.g. 60 * numPlayers).
    handTotalChips: players.reduce((sum, p) => sum + p.chips, 0) + pot,
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
  if (player.id !== myPlayerId || player.folded) return;
  const diff = game.currentBet - player.bet;
  const pay = Math.min(diff, player.chips);
  // Deduct chips and update bet
  player.chips -= pay;
  player.bet += pay;
  // Replace the player object in the array before computing pot
  game.players[idx] = player;
  // Recompute the pot based on the difference between the starting total
  // chips and the current sum of chips. This ensures the pot reflects all
  // contributions from blinds, calls and raises.
  if (game.handTotalChips) {
    const chipsSum = game.players.reduce((sum, p) => sum + p.chips, 0);
    game.pot = game.handTotalChips - chipsSum;
  } else {
    // Fallback: add the pay difference (legacy behavior)
    game.pot += pay;
  }
  player.hasActed = true;
  const nextIdx = nextActiveIndex(game.players, idx);
  const activePlayers = game.players.filter(p => !p.folded && !p.eliminated);
  const allActed = activePlayers.every(p => p.hasActed);
  if (allActed) {
    // Persist the updated players and pot before advancing. Without this,
    // the recomputed pot could be lost when advanceRound() writes only
    // selected fields back to Firestore.
    await updateDoc(docRef, {
      players: game.players,
      pot: game.pot,
    });
    await advanceRound(game);
  } else {
    // Persist players, pot and next player index for the ongoing betting round.
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
  const gameSnap = await getDoc(doc(db, 'games', currentGameId));
  const currentGame = gameSnap.data();
  const activePlayers = currentGame.players.filter(p => !p.folded && !p.eliminated);
  if (activePlayers.length > 0) {
    const minChips = Math.min(...activePlayers.map(p => p.chips));
    if (raiseAmount > minChips) {
      messageArea.textContent = `Raise amount exceeds the maximum allowed (${minChips}).`;
      return;
    }
  }
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef);
  const game = snap.data();
  const idx = game.currentPlayerIndex;
  const player = game.players[idx];
  if (player.id !== myPlayerId || player.folded) return;
  const newBet = game.currentBet + raiseAmount;
  const diff = newBet - player.bet;
  const pay = Math.min(diff, player.chips);
  // Deduct chips and update the player's bet
  player.chips -= pay;
  player.bet += pay;
  // Replace the raiser in the array before recomputing the pot
  game.players[idx] = player;
  // Recompute the pot based on the difference between the starting total chips
  // for the hand and the current sum of chips. This ensures the pot always
  // reflects all contributions. Fallback to adding pay if the property is missing.
  if (game.handTotalChips) {
    const chipsSum = game.players.reduce((sum, p) => sum + p.chips, 0);
    game.pot = game.handTotalChips - chipsSum;
  } else {
    game.pot += pay;
  }
  // Set currentBet to the intended new bet level (not the raiser's individual bet)
  game.currentBet = newBet;
  game.lastAggressivePlayerIndex = idx;
  game.players.forEach((p) => {
    if (!p.folded && !p.eliminated) {
      p.hasActed = (p.id === player.id);
    }
  });
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
  const activeIndices = [];
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i];
    if (!p.folded && !p.eliminated) {
      activeIndices.push(i);
    }
  }
  if (activeIndices.length === 1) {
    // When only one player remains, award the entire pot to that player.
    const winnerIdx = activeIndices[0];
    const potAmount = game.pot;
    game.players[winnerIdx].chips += potAmount;
    game.pot = 0;
    game.phase = 'finished';
    // Report the amount actually won (before resetting pot)
    game.outcomeMessage = `${game.players[winnerIdx].name} wins ${potAmount} chips (all others folded)`;
    await updateDoc(docRef, {
      players: game.players,
      pot: game.pot,
      phase: game.phase,
      outcomeMessage: game.outcomeMessage,
    });
    return;
  }
  const nextIdx = nextActiveIndex(game.players, idx);
  if (idx === game.lastAggressivePlayerIndex) {
    let prev = idx;
    do {
      prev = (prev - 1 + game.players.length) % game.players.length;
      if (!game.players[prev].folded && !game.players[prev].eliminated) break;
    } while (true);
    game.lastAggressivePlayerIndex = prev;
  }
  game.players[idx] = player;
  const activePlayers = game.players.filter(p => !p.folded && !p.eliminated);
  const allActed = activePlayers.every(p => p.hasActed);
  if (allActed) {
    await advanceRound(game);
  } else {
    await updateDoc(docRef, {
      players: game.players,
      currentPlayerIndex: nextIdx,
      lastAggressivePlayerIndex: game.lastAggressivePlayerIndex,
    });
  }
}

// Advance to next betting round or sniping/showdown
async function advanceRound(game) {
  const docRef = doc(db, 'games', currentGameId);
  game.players.forEach((p) => {
    p.bet = 0;
    p.hasActed = false;
  });
  if (game.bettingRound === 0) {
    const deck = game.deck;
    const card1 = deck.pop();
    const card2 = deck.pop();
    game.communityCards.push(card1, card2);
    game.bettingRound = 1;
    game.phase = 'flop';
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
      // Carry forward the current pot to the next round.  Without
      // specifying this, the pot persists implicitly, but including it
      // ensures clarity and consistency across updates.
      pot: game.pot,
    });
  } else if (game.bettingRound === 1) {
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
      pot: game.pot,
    });
  } else if (game.bettingRound === 2) {
    game.phase = 'sniping';
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

// Submit a snipe declaration
async function submitSnipe(snipe) {
  const docRef = doc(db, 'games', currentGameId);
  const snap = await getDoc(docRef);
  const game = snap.data();
  if (game.phase !== 'sniping') return;
  if (game.players[game.snipingIndex].id !== myPlayerId) return;
  const snipes = game.snipes || [];
  if (snipe) {
    if (typeof snipe === 'string') {
      const handStr = snipe;
      const trimmed = handStr.replace(/\s+/g, '');
      if (trimmed) {
        const parts = trimmed.split('-');
        const numbers = parts.map(x => parseInt(x));
        if (numbers.length === 5 && numbers.every(n => !isNaN(n) && n >= 1 && n <= 10)) {
          const sorted = numbers.slice().sort((a, b) => a - b);
          snipes.push(sorted.join('-'));
        }
      }
    } else if (typeof snipe === 'object') {
      const cat = snipe.category;
      const val = snipe.value;
      if (cat && val) {
        snipes.push({
          by: myPlayerId,
          name: myName,
          category: parseInt(cat),
          value: parseInt(val),
        });
      }
    }
  }
  let nextIdx = nextActiveIndex(game.players, game.snipingIndex);
  if (nextIdx === game.snipingStartIndex) {
    await resolveShowdown(game, snipes);
  } else {
    await updateDoc(docRef, {
      snipes: snipes,
      snipingIndex: nextIdx,
    });
  }
}

// Resolve showdown
async function resolveShowdown(game, snipes) {
  const docRef = doc(db, 'games', currentGameId);
  const activePlayers = game.players.filter(p => !p.folded && !p.eliminated);
  const results = [];
  for (const p of activePlayers) {
    const { rank, comboStr } = bestHandForPlayer(p, game.communityCards, snipes);
    results.push({ player: p, rank, comboStr });
  }
  let bestRank = [0];
  results.forEach(res => {
    if (compareRanks(res.rank, bestRank) > 0) {
      bestRank = res.rank;
    }
  });
  const winners = results.filter(res => compareRanks(res.rank, bestRank) === 0);
  const share = Math.floor(game.pot / winners.length);
  let remainder = game.pot % winners.length;
  winners.forEach(res => {
    res.player.chips += share;
    if (remainder > 0) {
      res.player.chips += 1;
      remainder--;
    }
  });
  let outcome;
  if (winners.length === 1) {
    outcome = `${winners[0].player.name} wins ${game.pot} chips.`;
  } else {
    const names = winners.map(w => w.player.name).join(' and ');
    outcome = `${names} split the pot of ${game.pot} chips.`;
  }
  let snipeSummary = '';
  if (snipes && snipes.length > 0) {
    const descs = snipes.map(s => {
      if (!s) return '';
      if (typeof s === 'string') {
        return `5-card hand ${s}`;
      }
      const cat = s.category;
      const val = s.value;
      let desc;
      switch (cat) {
        case 7:
          desc = `Four of a Kind (${val})`;
          break;
        case 6:
          desc = `Full House (trip ${val})`;
          break;
        case 5:
          desc = `Straight to ${val}`;
          break;
        case 4:
          desc = `Three of a Kind (${val})`;
          break;
        case 3:
          desc = `Two Pair (highest ${val})`;
          break;
        case 2:
          desc = `Pair of ${val}s`;
          break;
        default:
          desc = `High Card ${val}`;
          break;
      }
      return `${desc} by ${s.name}`;
    }).filter(Boolean);
    if (descs.length > 0) {
      snipeSummary = ' Sniped: ' + descs.join(', ') + '.';
    }
  }
  let winningDesc = '';
  if (bestRank && bestRank[0] > 0) {
    const cat = bestRank[0];
    const high = bestRank[1];
    switch (cat) {
      case 7:
        winningDesc = `Four of a Kind (${high})`;
        break;
      case 6:
        winningDesc = `Full House (trip ${high})`;
        break;
      case 5:
        winningDesc = `Straight to ${high}`;
        break;
      case 4:
        winningDesc = `Three of a Kind (${high})`;
        break;
      case 3:
        winningDesc = `Two Pair (highest ${high})`;
        break;
      case 2:
        winningDesc = `Pair of ${high}s`;
        break;
      default:
        winningDesc = `High Card ${high}`;
        break;
    }
    winningDesc = ' Winning combination: ' + winningDesc + '.';
  }
  outcome = outcome + snipeSummary + winningDesc;
  game.pot = 0;
  const updatedPlayers = game.players.map(p => {
    const res = winners.find(w => w.player.id === p.id);
    if (res) {
      return { ...res.player };
    }
    return { ...p };
  });
  updatedPlayers.forEach(p => {
    if (p.chips <= 0) {
      p.eliminated = true;
    }
  });
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

// Wire up UI buttons
callBtn.addEventListener('click', () => {
  callAction();
});
// The raise button functionality is handled dynamically in renderGame().
// A click on raise will reveal the raise amount field along with confirm and
// cancel buttons; see renderGame() for details.
raiseBtn.addEventListener('click', () => {
  // Intentionally left blank. Logic defined in renderGame().
});
foldBtn.addEventListener('click', () => {
  foldAction();
});

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
  myPlayerId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : generateGameCode() + Date.now();
  const gameId = generateGameCode();
  currentGameId = gameId;
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
  myPlayerId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : generateGameCode() + Date.now();
  currentGameId = gameId;
  const docRef = doc(db, 'games', gameId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    lobbyStatus.textContent = 'No such game exists.';
    return;
  }
  const game = snap.data();
  if (game.players.length >= 10) {
    lobbyStatus.textContent = 'Game is full (max 10 players).';
    return;
  }
  // When joining, always add the new player as an active participant.  Even
  // if the game has already started, the joining player should not be
  // flagged as folded or as having already acted.  This allows the game
  // state to cleanly reset them at the start of the next hand.  They will
  // still sit out the remainder of the current hand because their entry
  // occurs after the current betting sequence has begun.
  const newPlayer = {
    id: myPlayerId,
    name: myName,
    chips: 60,
    hole: [],
    bet: 0,
    folded: false,
    eliminated: false,
    hasActed: false,
  };
  const updatedPlayers = [...game.players, newPlayer];
  const updateObj = { players: updatedPlayers };
  // If a player joins during an ongoing hand and we are tracking
  // handTotalChips, include the new player's chips so the pot can be
  // recomputed correctly.  Without this adjustment, the recomputed pot
  // could become negative when players join mid-hand.
  if (game.started && game.handTotalChips !== undefined) {
    updateObj.handTotalChips = game.handTotalChips + newPlayer.chips;
  }
  await updateDoc(docRef, updateObj);
  if (game.started) {
    // Inform the player that they will be seated for the next hand.  The
    // current betting round will proceed without them.
    lobbyStatus.textContent = `Joined game ${gameId}. You'll participate starting next hand.`;
  } else {
    lobbyStatus.textContent = `Joined game ${gameId}.`;
  }
  subscribeToGame(gameId);
});
