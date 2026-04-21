/* ============================================
   SCRIPT.JS — Pokémon Battle Arena

   Nuevas restricciones implementadas:
   - ❌ Pokémon legendarios/míticos prohibidos (IDs 144-146, 150-151)
   - 💰 Costo calculado automáticamente (BST / 4) + penalización por derrota
   - ⚔️  Combate secuencial: el jugador elige a qué rival enfrentarse
   - 📈 Precio sube +100 créditos por derrota
   - 🛑 El juego se detiene al perder contra un rival
   ============================================ */

import { saveBattleResult } from './firebase.js';

/* ============================================
   CONSTANTES
   ============================================ */
const POKEAPI_BASE_URL   = 'https://pokeapi.co/api/v2';
const GEN1_POKEMON_COUNT = 151;
const TEAM_SIZE          = 6;
const NUM_RIVALS         = 4;
const BUDGET             = 1000;
const BATCH_SIZE         = 10;
const PRICE_PENALTY      = 100; // Créditos extra por derrota

/**
 * IDs de Pokémon legendarios y míticos de Gen 1.
 * Están completamente PROHIBIDOS en el equipo del jugador.
 *
 * 144: Articuno  · 145: Zapdos  · 146: Moltres
 * 150: Mewtwo    · 151: Mew (mítico)
 */
const GEN1_LEGENDARY_IDS = new Set([144, 145, 146, 150, 151]);

/**
 * Costo base automático de un Pokémon.
 * Basado en la suma de todos sus stats base (BST).
 * Ejemplos: Magikarp (BST 200) → 50 cr · Promedio (400) → 100 cr · Mewtwo (680) → 170 cr
 *
 * @param {number} totalBaseStats
 * @returns {number}
 */
function calculateBaseCost(totalBaseStats) {
  return Math.round(totalBaseStats / 4);
}

/* ============================================
   ESTADO GLOBAL
   ============================================ */
let allPokemon     = [];              // Todos los Pokémon Gen 1 cargados con sus stats
let myTeam         = [];              // Equipo del jugador (máx 6)
let searchQuery    = '';              // Filtro de búsqueda del Pokédex
let priceBonus     = 0;              // Penalización acumulada por derrotas (+100 c/u)
let rivalTeams     = [];             // Los 4 equipos rivales generados
let defeatedRivals = new Set();      // Índices (0-3) de rivales ya derrotados
let battleActive   = false;           // True mientras estamos en modo batalla
let myBattleAttack = 0;              // Ataque total del jugador en la batalla activa

/* ============================================
   REFERENCIAS DEL DOM
   ============================================ */
const loadingOverlay      = document.getElementById('loading-overlay');
const loadingSubtext      = document.getElementById('loading-subtext');
const loadingProgressFill = document.getElementById('loading-progress-fill');
const teamBuilder         = document.getElementById('team-builder');
const budgetFill          = document.getElementById('budget-fill');
const budgetText          = document.getElementById('budget-text');
const teamCount           = document.getElementById('team-count');
const myTeamSlots         = document.getElementById('my-team-slots');
const btnBattle           = document.getElementById('btn-battle');
const pokedexSearch       = document.getElementById('pokedex-search');
const pokedexGrid         = document.getElementById('pokedex-grid');
const battleArena         = document.getElementById('battle-arena');
const battleArenaContent  = document.getElementById('battle-arena-content');
const toastContainer      = document.getElementById('toast-container');

/* ============================================================
   SECCIÓN 1: CARGA DE DATOS DESDE POKÉAPI
   ============================================================ */

async function fetchFirstGenPokemonList() {
  const response = await fetch(`${POKEAPI_BASE_URL}/generation/1`);
  if (!response.ok) throw new Error(`PokéAPI error: ${response.status}`);
  const data = await response.json();
  return data.pokemon_species;
}

function extractIdFromUrl(url) {
  const parts = url.replace(/\/$/, '').split('/');
  return parseInt(parts[parts.length - 1], 10);
}

/**
 * Obtiene detalles completos de un Pokémon: stats, imagen, tipos y si es legendario.
 * @param {string} name
 * @returns {Object} { id, name, image, types, attack, totalStats, cost, isLegendary }
 */
async function fetchPokemonDetails(name) {
  const response = await fetch(`${POKEAPI_BASE_URL}/pokemon/${name}`);
  if (!response.ok) throw new Error(`Error al obtener "${name}": ${response.status}`);

  const data     = await response.json();
  const statsMap = {};
  data.stats.forEach(s => { statsMap[s.stat.name] = s.base_stat; });
  const totalStats = data.stats.reduce((sum, s) => sum + s.base_stat, 0);

  return {
    id:   data.id,
    name: data.name,
    image:
      data.sprites?.other?.['official-artwork']?.front_default ||
      data.sprites?.front_default ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${data.id}.png`,
    types:       data.types.map(t => t.type.name),
    attack:      statsMap['attack'] || 0,
    totalStats,
    cost:        calculateBaseCost(totalStats),   // Costo BASE (permanente)
    isLegendary: GEN1_LEGENDARY_IDS.has(data.id) // Legendario/mítico → prohibido
  };
}

/**
 * Carga todos los 151 Pokémon de Gen 1 mostrando barra de progreso.
 */
async function loadAllPokemon() {
  setLoading(true);
  teamBuilder.style.display = 'none';

  try {
    const speciesList = await fetchFirstGenPokemonList();

    const gen1Sorted = speciesList
      .filter(p => {
        const id = extractIdFromUrl(p.url);
        return id >= 1 && id <= GEN1_POKEMON_COUNT;
      })
      .sort((a, b) => extractIdFromUrl(a.url) - extractIdFromUrl(b.url));

    const names = gen1Sorted.map(p => p.name);
    const total = names.length;
    allPokemon  = [];

    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      const batch = names.slice(i, i + BATCH_SIZE);
      const batchResult = await Promise.all(batch.map(n => fetchPokemonDetails(n)));
      allPokemon.push(...batchResult);

      const pct = Math.round(((i + batch.length) / total) * 100);
      loadingProgressFill.style.width = `${pct}%`;
      loadingSubtext.textContent      = `Cargando Pokédex... ${allPokemon.length} / ${total}`;
    }

    console.log(`✅ ${allPokemon.length} Pokémon de Gen 1 cargados.`);
    console.log(`🚫 ${GEN1_LEGENDARY_IDS.size} legendarios/míticos bloqueados del equipo del jugador.`);

  } catch (error) {
    console.error('❌ Error al cargar el Pokédex:', error);
    showToast('Error al cargar el Pokédex. Recarga la página.', 'error', 8000);
  } finally {
    setLoading(false);
    teamBuilder.style.display = 'block';
    renderMyTeamSlots();
    updateBudgetBar();
    renderPokedex();
  }
}

/* ============================================================
   SECCIÓN 2: SISTEMA DE COSTOS CON PENALIZACIÓN
   ============================================================ */

/**
 * Costo efectivo = costo base + penalización acumulada por derrotas.
 * El costo base nunca cambia; la penalización se suma dinámicamente.
 *
 * @param {Object} pokemon
 * @returns {number}
 */
function getEffectiveCost(pokemon) {
  return pokemon.cost + priceBonus;
}

/** Suma de costos efectivos del equipo actual */
function getUsedBudget() {
  return myTeam.reduce((sum, p) => sum + getEffectiveCost(p), 0);
}

/* ============================================================
   SECCIÓN 3: GESTIÓN DEL EQUIPO
   ============================================================ */

/**
 * Valida si un Pokémon puede añadirse al equipo.
 * Restricciones: no legendario, no equipo lleno, no duplicado, no excede presupuesto.
 */
function canAdd(pokemon) {
  if (pokemon.isLegendary)                                        return false;
  if (myTeam.length >= TEAM_SIZE)                                 return false;
  if (myTeam.find(p => p.id === pokemon.id))                      return false;
  if (getUsedBudget() + getEffectiveCost(pokemon) > BUDGET)       return false;
  return true;
}

function isInTeam(pokemonId) {
  return !!myTeam.find(p => p.id === pokemonId);
}

function addToTeam(pokemon) {
  if (pokemon.isLegendary) {
    showToast(`🚫 ¡${capitalize(pokemon.name)} es legendario y está prohibido!`, 'error', 3500);
    return;
  }
  if (myTeam.length >= TEAM_SIZE) {
    showToast('¡Tu equipo ya tiene 6 Pokémon!', 'error');
    return;
  }
  if (isInTeam(pokemon.id)) {
    showToast(`${capitalize(pokemon.name)} ya está en tu equipo.`, 'error');
    return;
  }
  if (getUsedBudget() + getEffectiveCost(pokemon) > BUDGET) {
    showToast(
      `¡Presupuesto insuficiente! ${capitalize(pokemon.name)} cuesta ${getEffectiveCost(pokemon)} créditos.`,
      'error'
    );
    return;
  }

  myTeam.push(pokemon);
  updateAllUI();
  showToast(`${capitalize(pokemon.name)} añadido al equipo ✓`, 'success', 2000);
}

function removeFromTeam(pokemonId) {
  const pokemon = myTeam.find(p => p.id === pokemonId);
  myTeam = myTeam.filter(p => p.id !== pokemonId);
  updateAllUI();
  if (pokemon) showToast(`${capitalize(pokemon.name)} retirado.`, 'info', 2000);
}

// Exponer funciones para onclick inline del HTML renderizado
window.addToTeam_id   = (id) => { const p = allPokemon.find(x => x.id === id); if (p) addToTeam(p); };
window.removeFromTeam = removeFromTeam;

/* ============================================================
   SECCIÓN 4: ACTUALIZACIÓN DE LA INTERFAZ
   ============================================================ */

function updateAllUI() {
  renderMyTeamSlots();
  updateBudgetBar();
  updateBattleButton();
  renderPokedex();
}

/** Actualiza barra de presupuesto con porcentaje y color dinámico */
function updateBudgetBar() {
  const used      = getUsedBudget();
  const pct       = Math.min((used / BUDGET) * 100, 100);
  const remaining = BUDGET - used;

  budgetFill.style.width = `${pct}%`;
  budgetText.textContent = `${used} / ${BUDGET} créditos  (${remaining} disponibles)`;

  budgetFill.className = 'budget-fill';
  if      (pct > 90) budgetFill.classList.add('budget-fill--danger');
  else if (pct > 65) budgetFill.classList.add('budget-fill--warning');
  else               budgetFill.classList.add('budget-fill--ok');

  // Banner de penalización por derrota
  const penaltyBanner = document.getElementById('penalty-banner');
  if (penaltyBanner) {
    penaltyBanner.style.display = priceBonus > 0 ? 'flex' : 'none';
    const el = document.getElementById('penalty-text');
    if (el) el.textContent = `+${priceBonus} créditos de penalización por derrotas`;
  }
}

/** El botón de combate sólo se activa si el equipo tiene los 6 Pokémon y no hay batalla activa */
function updateBattleButton() {
  btnBattle.disabled = myTeam.length < TEAM_SIZE || battleActive;
}

/** Renderiza los 6 slots del equipo del jugador */
function renderMyTeamSlots() {
  teamCount.textContent = `(${myTeam.length}/${TEAM_SIZE})`;

  const slotsHTML = Array.from({ length: TEAM_SIZE }, (_, i) => {
    const pokemon = myTeam[i];
    if (pokemon) {
      const displayName = capitalize(pokemon.name);
      const effCost     = getEffectiveCost(pokemon);
      return `
        <div class="team-slot team-slot--filled" data-id="${pokemon.id}">
          <img
            class="team-slot__img"
            src="${pokemon.image}"
            alt="${displayName}"
            loading="lazy"
            onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png'"
          >
          <p class="team-slot__name">${displayName}</p>
          <p class="team-slot__cost">💰 ${effCost}</p>
          <p class="team-slot__attack">⚔️ ATK ${pokemon.attack}</p>
          <button
            class="team-slot__remove"
            onclick="removeFromTeam(${pokemon.id})"
            aria-label="Quitar ${displayName}"
          >✕</button>
        </div>
      `;
    }
    return `
      <div class="team-slot team-slot--empty" aria-label="Slot vacío">
        <div class="team-slot__placeholder">?</div>
      </div>
    `;
  });

  myTeamSlots.innerHTML = slotsHTML.join('');
}

/** Renderiza el Pokédex con búsqueda, costos actualizados y badge de legendarios */
function renderPokedex() {
  if (allPokemon.length === 0) return;

  const query    = searchQuery.toLowerCase().trim();
  const filtered = allPokemon.filter(p =>
    !query || p.name.includes(query) || String(p.id).includes(query)
  );

  if (filtered.length === 0) {
    pokedexGrid.innerHTML = `<p class="pokedex-empty">No se encontraron Pokémon.</p>`;
    return;
  }

  const html = filtered.map(pokemon => {
    const inTeam      = isInTeam(pokemon.id);
    const addable     = canAdd(pokemon);
    const effCost     = getEffectiveCost(pokemon);
    const displayName = capitalize(pokemon.name);
    const typeBadges  = pokemon.types
      .map(t => `<span class="type-badge type-badge--${t}">${t}</span>`)
      .join('');

    const isLegendary = pokemon.isLegendary;

    const cardClasses = [
      'pkdx-card',
      isLegendary                            ? 'pkdx-card--legendary'  : '',
      inTeam                                 ? 'pkdx-card--in-team'    : '',
      (!addable && !inTeam && !isLegendary)  ? 'pkdx-card--disabled'   : ''
    ].filter(Boolean).join(' ');

    // Badge de legendario (bloqueado)
    const legendBadge = isLegendary
      ? `<div class="legendary-badge">🚫 PROHIBIDO</div>`
      : '';

    // Mostrar incremento de precio si hay penalización
    const costHTML = priceBonus > 0 && !isLegendary
      ? `<span class="pkdx-cost pkdx-cost--boosted">💰 ${effCost}<small>+${priceBonus}</small></span>`
      : `<span class="pkdx-cost">💰 ${effCost}</span>`;

    // Botón: si es legendario, no se muestra; si está en equipo, quitar; si no, añadir
    const actionBtn = isLegendary ? '' : `
      <button
        class="pkdx-card__btn ${inTeam ? 'pkdx-card__btn--remove' : 'pkdx-card__btn--add'}"
        onclick="${inTeam ? `removeFromTeam(${pokemon.id})` : `addToTeam_id(${pokemon.id})`}"
        ${(!addable && !inTeam) ? 'disabled' : ''}
        aria-label="${inTeam ? `Quitar ${displayName}` : `Añadir ${displayName}`}"
      >${inTeam ? '✕ Quitar' : '+ Añadir'}</button>
    `;

    return `
      <article class="${cardClasses}" data-pokemon-id="${pokemon.id}">
        ${legendBadge}
        <p class="pkdx-card__id">#${String(pokemon.id).padStart(3, '0')}</p>
        <div class="pkdx-card__img-wrap">
          <img
            class="pkdx-card__img"
            src="${pokemon.image}"
            alt="${displayName}"
            loading="lazy"
            onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png'"
          >
        </div>
        <h3 class="pkdx-card__name">${displayName}</h3>
        <div class="pkdx-card__types">${typeBadges}</div>
        <div class="pkdx-card__stats">
          <span class="pkdx-stat">⚔️ ${pokemon.attack}</span>
          ${costHTML}
        </div>
        ${actionBtn}
      </article>
    `;
  }).join('');

  pokedexGrid.innerHTML = html;
}

/* ============================================================
   SECCIÓN 5: SISTEMA DE COMBATE SECUENCIAL
   ============================================================ */

function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function calculateTeamAttack(team) {
  return team.reduce((sum, p) => sum + p.attack, 0);
}

/**
 * Inicia el modo batalla:
 * 1. Genera 4 equipos rivales aleatorios (rivales SÍ pueden ser legendarios)
 * 2. Guarda el ataque total del jugador
 * 3. Muestra la arena de selección de rivales
 */
function handleBattle() {
  if (myTeam.length < TEAM_SIZE) return;

  // Excluir solo los Pokémon que ya están en mi equipo
  const myIds = new Set(myTeam.map(p => p.id));
  const pool  = allPokemon.filter(p => !myIds.has(p.id));

  if (pool.length < NUM_RIVALS * TEAM_SIZE) {
    showToast('No hay suficientes Pokémon disponibles para los rivales.', 'error');
    return;
  }

  const shuffled = shuffleArray(pool);
  rivalTeams = Array.from({ length: NUM_RIVALS }, (_, i) =>
    shuffled.slice(i * TEAM_SIZE, (i + 1) * TEAM_SIZE)
  );

  defeatedRivals = new Set();
  battleActive   = true;
  myBattleAttack = calculateTeamAttack(myTeam);

  battleArena.hidden = false;
  battleArena.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateBattleButton(); // Deshabilitar mientras hay batalla activa

  renderBattleArena();
  showToast('¡Elige a qué rival desafiar!', 'info', 3000);
}

/**
 * El jugador elige desafiar a un rival específico.
 * Si gana → rival marcado como derrotado, puede elegir el siguiente.
 * Si pierde → fin de partida, precios suben +100.
 *
 * @param {number} rivalIndex - Índice del rival 0-3
 */
window.handleChallenge = function(rivalIndex) {
  if (!battleActive || defeatedRivals.has(rivalIndex)) return;

  const rivalTeam   = rivalTeams[rivalIndex];
  const rivalAttack = calculateTeamAttack(rivalTeam);

  if (myBattleAttack >= rivalAttack) {
    // ─── VICTORIA contra este rival ───
    defeatedRivals.add(rivalIndex);

    if (myBattleAttack === rivalAttack) {
      showToast(`🤝 ¡Empate contra el Rival ${rivalIndex + 1}! Se cuenta como victoria.`, 'info', 3500);
    } else {
      showToast(`🏆 ¡Derrotaste al Rival ${rivalIndex + 1}!`, 'success', 3000);
    }

    if (defeatedRivals.size === NUM_RIVALS) {
      // ─── CAMPEÓN: todos los rivales derrotados ───
      handleVictory();
    } else {
      renderBattleArena(); // Re-renderizar con el rival marcado como derrotado
    }

  } else {
    // ─── DERROTA ───
    handleGameOver(rivalIndex, rivalAttack);
  }
};

/**
 * Flujo de derrota:
 * 1. Aumenta priceBonus en PRICE_PENALTY (100 créditos)
 * 2. Valida el equipo actual con los nuevos precios
 * 3. Si el equipo ya no cabe en el presupuesto, se limpia automáticamente
 * 4. Muestra la pantalla de Game Over
 */
function handleGameOver(defeatingRivalIndex, rivalAttack) {
  battleActive = false;

  // Aumentar penalización de precios
  priceBonus += PRICE_PENALTY;

  // Verificar si el equipo actual sigue siendo válido con los nuevos precios
  const newTeamCost = myTeam.reduce((sum, p) => sum + getEffectiveCost(p), 0);
  const teamCleared = newTeamCost > BUDGET;
  if (teamCleared) {
    myTeam = [];
  }

  renderGameOver(defeatingRivalIndex, rivalAttack, teamCleared);
}

/**
 * Flujo de victoria total:
 * Guarda el resultado en Firebase y muestra la pantalla de campeón.
 */
function handleVictory() {
  battleActive = false;
  renderVictory();

  saveBattleResult(myTeam, rivalTeams, myBattleAttack)
    .catch(e => console.warn('⚠️ No se pudo guardar en Firebase:', e.message));
}

/** Vuelve al constructor de equipo desde la arena de batalla */
window.returnToBuilder = function() {
  battleArena.hidden = true;
  updateAllUI();
  teamBuilder.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/** Lanza una nueva batalla desde el principio */
window.newBattle = function() {
  battleActive = false;
  battleArena.hidden = true;
  updateAllUI();
  teamBuilder.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* ============================================================
   SECCIÓN 6: RENDERIZADO DE LA ARENA DE BATALLA
   ============================================================ */

/**
 * Renderiza la arena de batalla completa en función del estado actual.
 * Muestra: barra de progreso, ataque del jugador y las 4 tarjetas de rivales.
 */
function renderBattleArena() {
  const pending  = NUM_RIVALS - defeatedRivals.size;
  const progress = `
    <div class="battle-progress">
      <div class="battle-progress-top">
        <span class="battle-progress-label">⚔️ Selecciona tu próximo rival</span>
        <span class="battle-progress-counter">
          <span class="bp-defeated">${defeatedRivals.size}</span>
          <span class="bp-sep"> / </span>
          <span class="bp-total">${NUM_RIVALS}</span>
          <span class="bp-text"> derrotados</span>
        </span>
      </div>
      <div class="battle-progress-track">
        <div class="battle-progress-fill" style="width:${(defeatedRivals.size / NUM_RIVALS) * 100}%"></div>
      </div>
      ${pending > 0
        ? `<p class="battle-progress-hint">Te quedan <strong>${pending}</strong> rival${pending > 1 ? 'es' : ''} por derrotar.</p>`
        : ''}
    </div>
  `;

  const myAtk = `
    <div class="battle-my-attack">
      <div class="battle-my-attack-inner">
        <span class="bma-label">⚔️ Tu ataque total</span>
        <span class="bma-value">${myBattleAttack}</span>
      </div>
    </div>
  `;

  const cards = rivalTeams.map((team, i) => renderRivalCard(team, i)).join('');

  battleArenaContent.innerHTML = `
    ${progress}
    ${myAtk}
    <div class="rival-cards-grid">${cards}</div>
  `;
}

/**
 * Renderiza una tarjeta de rival individual.
 * - No derrotado: Pokémon como silueta negra, botón "Desafiar"
 * - Derrotado: Pokémon a color, badge "Derrotado"
 *
 * @param {Array} team
 * @param {number} index
 * @returns {string} HTML
 */
function renderRivalCard(team, index) {
  const isDefeated  = defeatedRivals.has(index);
  const rivalAttack = calculateTeamAttack(team);

  const pokemonImgs = team.map(p => `
    <div class="rival-pokemon ${isDefeated ? 'rival-pokemon--revealed' : 'rival-pokemon--mystery'}">
      <img
        class="rival-pokemon__img"
        src="${p.image}"
        alt="${isDefeated ? capitalize(p.name) : 'Pokémon misterioso'}"
        loading="lazy"
        onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png'"
      >
    </div>
  `).join('');

  const statusBadge = isDefeated
    ? `<div class="rival-status-badge rival-status--defeated">🏆 Derrotado</div>`
    : `<div class="rival-status-badge rival-status--unknown">❓ Desconocido</div>`;

  const attackLine = isDefeated
    ? `<div class="rival-atk-info rival-atk-info--revealed">⚔️ Ataque: <strong>${rivalAttack}</strong></div>`
    : `<div class="rival-atk-info rival-atk-info--hidden">⚔️ Ataque: <strong>???</strong></div>`;

  const footer = isDefeated
    ? `<div class="rival-defeated-label">✔ Rival eliminado</div>`
    : `<button class="btn btn--challenge" onclick="handleChallenge(${index})">⚔️ Desafiar</button>`;

  return `
    <div class="rival-card ${isDefeated ? 'rival-card--defeated' : 'rival-card--active'}">
      <div class="rival-card-header">
        <h3 class="rival-card-title">Rival ${index + 1}</h3>
        ${statusBadge}
      </div>
      ${attackLine}
      <div class="rival-pokemon-grid">${pokemonImgs}</div>
      <div class="rival-card-footer">${footer}</div>
    </div>
  `;
}

/**
 * Renderiza la pantalla de Game Over con stats del combate perdido
 * y el aviso de penalización de precios.
 *
 * @param {number} defeatingRivalIndex
 * @param {number} rivalAttack
 * @param {boolean} teamCleared - true si el equipo tuvo que borrarse
 */
function renderGameOver(defeatingRivalIndex, rivalAttack, teamCleared) {
  const teamMsg = teamCleared
    ? `<div class="go-team-alert">
        ⚠️ Tu equipo fue disuelto porque los precios superaron el presupuesto.
        ¡Tendrás que armar uno nuevo con el presupuesto ajustado!
      </div>`
    : `<div class="go-team-ok">
        Tu equipo actual todavía cabe en el presupuesto, pero quizá quieras ajustarlo.
      </div>`;

  battleArenaContent.innerHTML = `
    <div class="game-over-screen">

      <div class="game-over-banner">
        <div class="game-over-icon" aria-hidden="true">💀</div>
        <h2 class="game-over-title">Derrota</h2>
        <p class="game-over-desc">
          Fuiste derrotado por el <strong>Rival ${defeatingRivalIndex + 1}</strong>.
        </p>
        <div class="game-over-stats-row">
          <div class="go-stat-box">
            <span class="go-stat-label">Tu ataque</span>
            <span class="go-stat-value go-stat-value--loss">${myBattleAttack}</span>
          </div>
          <div class="go-stat-vs">VS</div>
          <div class="go-stat-box">
            <span class="go-stat-label">Ataque rival</span>
            <span class="go-stat-value go-stat-value--win">${rivalAttack}</span>
          </div>
        </div>
      </div>

      <div class="price-penalty-banner">
        <div class="ppb-icon" aria-hidden="true">📈</div>
        <div class="ppb-text">
          <strong>Penalización: +${PRICE_PENALTY} créditos por Pokémon</strong>
          <span>Penalización total acumulada: <strong>+${priceBonus} créditos</strong> por Pokémon</span>
        </div>
      </div>

      ${teamMsg}

      <button class="btn btn--battle" onclick="returnToBuilder()">
        <span class="btn__icon" aria-hidden="true">🛡️</span>
        Reconstruir Equipo
      </button>
    </div>
  `;
}

/**
 * Renderiza la pantalla de victoria total (campeón de los 4 rivales).
 */
function renderVictory() {
  const rivalSummary = rivalTeams.map((team, i) => `
    <div class="victory-rival-row">
      <span class="vrr-label">Rival ${i + 1}</span>
      <span class="vrr-atk">ATK ${calculateTeamAttack(team)}</span>
      <span class="vrr-result">🏆</span>
    </div>
  `).join('');

  battleArenaContent.innerHTML = `
    <div class="victory-screen">

      <div class="victory-banner">
        <div class="victory-icon" aria-hidden="true">🏆</div>
        <h2 class="victory-title">¡CAMPEÓN!</h2>
        <p class="victory-subtitle">¡Derrotaste a los 4 rivales!</p>
        <div class="victory-stats-row">
          <div class="go-stat-box">
            <span class="go-stat-label">Tu ataque</span>
            <span class="go-stat-value go-stat-value--win">${myBattleAttack}</span>
          </div>
          <div class="go-stat-box">
            <span class="go-stat-label">Rivales derrotados</span>
            <span class="go-stat-value go-stat-value--win">4 / 4</span>
          </div>
        </div>
      </div>

      <div class="victory-rivals-summary">
        <h3 class="vrs-title">Rivales derrotados</h3>
        ${rivalSummary}
      </div>

      <button class="btn btn--secondary" onclick="newBattle()">
        <span class="btn__icon" aria-hidden="true">🔄</span>
        Nueva Batalla
      </button>
    </div>
  `;
}

/* ============================================================
   SECCIÓN 7: HELPERS
   ============================================================ */

function setLoading(show) {
  loadingOverlay.classList.toggle('active', show);
}

function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<span aria-hidden="true">${icons[type]}</span> ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ============================================================
   SECCIÓN 8: INICIALIZACIÓN
   ============================================================ */

function init() {
  btnBattle.addEventListener('click', handleBattle);
  pokedexSearch.addEventListener('input', e => {
    searchQuery = e.target.value;
    renderPokedex();
  });

  loadAllPokemon();
  console.log('🚀 Pokémon Battle Arena iniciado correctamente.');
}

init();
