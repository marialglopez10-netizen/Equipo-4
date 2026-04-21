/* ============================================
   SCRIPT.JS — Lógica principal de Pokémon Battle Arena.

   Responsabilidades:
   - Cargar todos los Pokémon de Gen 1 con sus stats
   - Calcular el costo automático de cada Pokémon
   - Gestionar el equipo del jugador (máx 6, máx 1000 créditos)
   - Renderizar el Pokédex con búsqueda en tiempo real
   - Generar 4 equipos rivales aleatorios al combatir
   - Calcular ganador por sumatoria de stat de Ataque
   - Mostrar rivales solo con imagen (sin stats ni nombre)
   - Guardar resultados en Firebase Firestore
   ============================================ */

import { saveBattleResult } from './firebase.js';

/* ============================================
   CONSTANTES
   ============================================ */
const POKEAPI_BASE_URL   = 'https://pokeapi.co/api/v2';
const GEN1_POKEMON_COUNT = 151;    // Gen 1: ID 1 → 151
const TEAM_SIZE          = 6;      // Pokémon por equipo
const NUM_RIVALS         = 4;      // Equipos rivales
const BUDGET             = 1000;   // Créditos disponibles
const BATCH_SIZE         = 10;     // Peticiones en paralelo por lote

/**
 * Fórmula de costo automático.
 * Se basa en la suma de todos los stats base del Pokémon.
 * Rango aproximado:
 *   Magikarp (BST 200) → 50 créditos
 *   Pokémon promedio (BST ~400) → 100 créditos
 *   Mewtwo (BST 680) → 170 créditos
 * Con 1000 créditos y 6 slots, no es posible llenar el equipo
 * solo con Pokémon legendarios, creando decisiones estratégicas.
 *
 * @param {number} totalBaseStats - Suma de los 6 stats base
 * @returns {number} Costo en créditos
 */
function calculateCost(totalBaseStats) {
  return Math.round(totalBaseStats / 4);
}

/* ============================================
   ESTADO GLOBAL
   ============================================ */
let allPokemon  = [];   // Todos los Pokémon Gen 1 ya cargados
let myTeam      = [];   // Equipo actual del jugador (máx 6)
let searchQuery = '';   // Filtro de búsqueda del Pokédex

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
const rivalsContainer     = document.getElementById('rivals-container');
const myTotalAttackEl     = document.getElementById('my-total-attack');
const btnRematch          = document.getElementById('btn-rematch');
const btnChangeTeam       = document.getElementById('btn-change-team');
const toastContainer      = document.getElementById('toast-container');

/* ============================================================
   SECCIÓN 1: OBTENCIÓN DE DATOS DESDE POKÉAPI
   ============================================================ */

/**
 * Obtiene la lista de especies de la primera generación.
 * @returns {Array} Lista de { name, url }
 */
async function fetchFirstGenPokemonList() {
  const response = await fetch(`${POKEAPI_BASE_URL}/generation/1`);
  if (!response.ok) {
    throw new Error(`PokéAPI respondió con estado ${response.status}`);
  }
  const data = await response.json();
  return data.pokemon_species;
}

/**
 * Extrae el ID numérico de la URL de una especie Pokémon.
 * Ej: "https://pokeapi.co/api/v2/pokemon-species/25/" → 25
 *
 * @param {string} url
 * @returns {number}
 */
function extractIdFromUrl(url) {
  const parts = url.replace(/\/$/, '').split('/');
  return parseInt(parts[parts.length - 1], 10);
}

/**
 * Obtiene los detalles completos de un Pokémon: ID, nombre, imagen,
 * tipos, stat de ataque, stats totales y costo calculado.
 *
 * @param {string} name - Nombre en minúsculas
 * @returns {Object} { id, name, image, types, attack, totalStats, cost }
 */
async function fetchPokemonDetails(name) {
  const response = await fetch(`${POKEAPI_BASE_URL}/pokemon/${name}`);
  if (!response.ok) {
    throw new Error(`No se pudo obtener: "${name}" (${response.status})`);
  }

  const data = await response.json();

  // Mapear stats a un objeto clave→valor para acceso rápido
  const statsMap = {};
  data.stats.forEach(s => {
    statsMap[s.stat.name] = s.base_stat;
  });

  const totalStats = data.stats.reduce((sum, s) => sum + s.base_stat, 0);

  return {
    id:         data.id,
    name:       data.name,
    image:
      data.sprites?.other?.['official-artwork']?.front_default ||
      data.sprites?.front_default ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${data.id}.png`,
    types:      data.types.map(t => t.type.name),
    attack:     statsMap['attack'] || 0,
    totalStats,
    cost:       calculateCost(totalStats)
  };
}

/**
 * Carga todos los Pokémon de Gen 1 en lotes de BATCH_SIZE,
 * actualizando la barra de progreso en pantalla.
 */
async function loadAllPokemon() {
  setLoading(true);
  teamBuilder.style.display = 'none';

  try {
    // 1. Obtener lista de especies
    const speciesList = await fetchFirstGenPokemonList();

    // 2. Filtrar solo Gen 1 (ID 1-151) y ordenar por ID
    const gen1Sorted = speciesList
      .filter(p => {
        const id = extractIdFromUrl(p.url);
        return id >= 1 && id <= GEN1_POKEMON_COUNT;
      })
      .sort((a, b) => extractIdFromUrl(a.url) - extractIdFromUrl(b.url));

    const names = gen1Sorted.map(p => p.name);
    const total = names.length;

    allPokemon = [];

    // 3. Cargar detalles en lotes
    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      const batch       = names.slice(i, i + BATCH_SIZE);
      const batchResult = await Promise.all(batch.map(n => fetchPokemonDetails(n)));

      allPokemon.push(...batchResult);

      // Actualizar barra de progreso
      const pct = Math.round(((i + batch.length) / total) * 100);
      loadingProgressFill.style.width = `${pct}%`;
      loadingSubtext.textContent      = `Cargando Pokédex... ${allPokemon.length} / ${total}`;
    }

    console.log(`✅ ${allPokemon.length} Pokémon de Gen 1 cargados.`);

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
   SECCIÓN 2: GESTIÓN DEL EQUIPO
   ============================================================ */

/** Suma los créditos gastados en el equipo actual */
function getUsedBudget() {
  return myTeam.reduce((sum, p) => sum + p.cost, 0);
}

/** Determina si se puede añadir un Pokémon al equipo */
function canAdd(pokemon) {
  if (myTeam.length >= TEAM_SIZE)                        return false;
  if (myTeam.find(p => p.id === pokemon.id))             return false;
  if (getUsedBudget() + pokemon.cost > BUDGET)           return false;
  return true;
}

/** Devuelve true si el Pokémon ya está en el equipo */
function isInTeam(pokemonId) {
  return !!myTeam.find(p => p.id === pokemonId);
}

/**
 * Añade un Pokémon al equipo del jugador, con validaciones.
 * @param {Object} pokemon
 */
function addToTeam(pokemon) {
  if (myTeam.length >= TEAM_SIZE) {
    showToast('¡Tu equipo ya tiene 6 Pokémon!', 'error');
    return;
  }
  if (isInTeam(pokemon.id)) {
    showToast(`${capitalize(pokemon.name)} ya está en tu equipo.`, 'error');
    return;
  }
  if (getUsedBudget() + pokemon.cost > BUDGET) {
    showToast(
      `¡Sin presupuesto para ${capitalize(pokemon.name)}! (Costo: ${pokemon.cost} créditos)`,
      'error'
    );
    return;
  }

  myTeam.push(pokemon);
  updateAllUI();
  showToast(`${capitalize(pokemon.name)} añadido al equipo ✓`, 'success', 2000);
}

/**
 * Retira un Pokémon del equipo por su ID.
 * @param {number} pokemonId
 */
function removeFromTeam(pokemonId) {
  const pokemon = myTeam.find(p => p.id === pokemonId);
  myTeam = myTeam.filter(p => p.id !== pokemonId);
  updateAllUI();
  if (pokemon) {
    showToast(`${capitalize(pokemon.name)} retirado del equipo.`, 'info', 2000);
  }
}

// Exponer a onclick inline en el HTML renderizado
window.addToTeam_id    = (id) => { const p = allPokemon.find(x => x.id === id); if (p) addToTeam(p); };
window.removeFromTeam  = removeFromTeam;

/* ============================================================
   SECCIÓN 3: ACTUALIZACIÓN DE LA INTERFAZ
   ============================================================ */

/** Llama a todos los renders en el orden correcto */
function updateAllUI() {
  renderMyTeamSlots();
  updateBudgetBar();
  updateBattleButton();
  renderPokedex();
}

/** Actualiza la barra de presupuesto con color dinámico */
function updateBudgetBar() {
  const used = getUsedBudget();
  const pct  = Math.min((used / BUDGET) * 100, 100);

  budgetFill.style.width      = `${pct}%`;
  budgetText.textContent      = `${used} / ${BUDGET} créditos`;

  budgetFill.className = 'budget-fill';
  if      (pct > 90) budgetFill.classList.add('budget-fill--danger');
  else if (pct > 65) budgetFill.classList.add('budget-fill--warning');
  else               budgetFill.classList.add('budget-fill--ok');
}

/** Habilita el botón de combate solo si el equipo está completo */
function updateBattleButton() {
  btnBattle.disabled = myTeam.length < TEAM_SIZE;
}

/** Renderiza los 6 slots del equipo propio */
function renderMyTeamSlots() {
  teamCount.textContent = `(${myTeam.length}/${TEAM_SIZE})`;

  const slotsHTML = Array.from({ length: TEAM_SIZE }, (_, i) => {
    const pokemon = myTeam[i];
    if (pokemon) {
      const displayName = capitalize(pokemon.name);
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
          <p class="team-slot__cost">💰 ${pokemon.cost}</p>
          <p class="team-slot__attack">⚔️ ATK ${pokemon.attack}</p>
          <button
            class="team-slot__remove"
            onclick="removeFromTeam(${pokemon.id})"
            aria-label="Quitar ${displayName} del equipo"
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

/** Renderiza el Pokédex completo, aplicando el filtro de búsqueda */
function renderPokedex() {
  if (allPokemon.length === 0) return;

  const query    = searchQuery.toLowerCase().trim();
  const filtered = allPokemon.filter(p =>
    !query || p.name.includes(query) || String(p.id).includes(query)
  );

  if (filtered.length === 0) {
    pokedexGrid.innerHTML = `<p class="pokedex-empty">No se encontraron Pokémon para "${searchQuery}".</p>`;
    return;
  }

  const html = filtered.map(pokemon => {
    const inTeam     = isInTeam(pokemon.id);
    const addable    = canAdd(pokemon);
    const displayName = capitalize(pokemon.name);
    const typeBadges = pokemon.types
      .map(t => `<span class="type-badge type-badge--${t}">${t}</span>`)
      .join('');

    const cardClass = [
      'pkdx-card',
      inTeam ? 'pkdx-card--in-team' : '',
      (!addable && !inTeam) ? 'pkdx-card--disabled' : ''
    ].filter(Boolean).join(' ');

    const btnClass  = inTeam ? 'pkdx-card__btn--remove' : 'pkdx-card__btn--add';
    const btnAction = inTeam
      ? `removeFromTeam(${pokemon.id})`
      : `addToTeam_id(${pokemon.id})`;
    const btnLabel  = inTeam ? '✕ Quitar' : '+ Añadir';
    const btnDisabled = (!addable && !inTeam) ? 'disabled' : '';

    return `
      <article class="${cardClass}" data-pokemon-id="${pokemon.id}">
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
          <span class="pkdx-cost">💰 ${pokemon.cost}</span>
        </div>
        <button
          class="pkdx-card__btn ${btnClass}"
          onclick="${btnAction}"
          ${btnDisabled}
          aria-label="${inTeam ? `Quitar ${displayName}` : `Añadir ${displayName} al equipo`}"
        >${btnLabel}</button>
      </article>
    `;
  }).join('');

  pokedexGrid.innerHTML = html;
}

/* ============================================================
   SECCIÓN 4: SISTEMA DE COMBATE
   ============================================================ */

/**
 * Mezcla un array usando el algoritmo Fisher-Yates.
 * @param {Array} arr
 * @returns {Array} Nuevo array mezclado
 */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Calcula la sumatoria de Ataque de un equipo completo.
 * Este valor determina el ganador del combate.
 *
 * @param {Array} team - Array de objetos Pokémon con propiedad `attack`
 * @returns {number} Ataque total del equipo
 */
function calculateTeamAttack(team) {
  return team.reduce((sum, p) => sum + p.attack, 0);
}

/**
 * Maneja el flujo completo de combate:
 * 1. Genera 4 rivales aleatorios (excluyendo mi equipo)
 * 2. Calcula mi ataque total vs el de cada rival
 * 3. Renderiza los resultados (rivales: solo imagen)
 * 4. Guarda en Firebase
 */
async function handleBattle() {
  if (myTeam.length < TEAM_SIZE) return;

  // Excluir Pokémon que ya están en mi equipo
  const myIds    = new Set(myTeam.map(p => p.id));
  const pool     = allPokemon.filter(p => !myIds.has(p.id));

  if (pool.length < NUM_RIVALS * TEAM_SIZE) {
    showToast('No hay suficientes Pokémon disponibles para los rivales.', 'error');
    return;
  }

  // Mezclar y tomar 4×6 Pokémon únicos
  const shuffled  = shuffleArray(pool);
  const rivalTeams = Array.from({ length: NUM_RIVALS }, (_, i) =>
    shuffled.slice(i * TEAM_SIZE, (i + 1) * TEAM_SIZE)
  );

  const myAttack = calculateTeamAttack(myTeam);

  // Renderizar arena de batalla
  myTotalAttackEl.textContent = myAttack;
  renderRivals(rivalTeams, myAttack);

  // Mostrar sección de batalla y hacer scroll
  battleArena.hidden = false;
  battleArena.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Guardar en Firebase (sin bloquear la UI)
  try {
    await saveBattleResult(myTeam, rivalTeams, myAttack);
  } catch (e) {
    console.warn('⚠️ No se pudo guardar en Firebase:', e.message);
  }
}

/**
 * Renderiza los 4 equipos rivales.
 * Solo se muestra la IMAGEN de cada Pokémon rival.
 * No se muestran nombre, tipos, ni stats (efecto misterioso).
 *
 * @param {Array} rivalTeams  - Array de 4 equipos de 6 Pokémon
 * @param {number} myAttack   - Ataque total de mi equipo
 */
function renderRivals(rivalTeams, myAttack) {
  const html = rivalTeams.map((team, i) => {
    const rivalAttack = calculateTeamAttack(team);
    const result      = myAttack > rivalAttack ? 'win'
                      : myAttack < rivalAttack ? 'loss'
                      : 'tie';

    const resultText = result === 'win'  ? '🏆 ¡VICTORIA!'
                     : result === 'loss' ? '💀 DERROTA'
                     : '🤝 EMPATE';

    // Tarjetas de imagen únicamente — sin nombre, sin tipo, sin stats
    const pokemonImgs = team.map(p => `
      <div class="rival-pokemon">
        <img
          class="rival-pokemon__img"
          src="${p.image}"
          alt="Pokémon rival"
          loading="lazy"
          onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png'"
        >
      </div>
    `).join('');

    return `
      <div class="rival-team result--${result}">
        <div class="rival-team-header">
          <h3 class="rival-team-title">Rival ${i + 1}</h3>
          <div class="rival-result-badge result--${result}">${resultText}</div>
        </div>
        <div class="rival-attack-info">
          Ataque rival: <strong>${rivalAttack}</strong>
          &nbsp;·&nbsp;
          Tu ataque: <strong>${myAttack}</strong>
        </div>
        <div class="rival-pokemon-grid">
          ${pokemonImgs}
        </div>
      </div>
    `;
  }).join('');

  rivalsContainer.innerHTML = html;
}

/** Lanza un nuevo combate (misma lógica, nuevos rivales aleatorios) */
function handleRematch() {
  handleBattle();
}

/** Vuelve al constructor de equipo */
function handleChangeTeam() {
  battleArena.hidden = true;
  teamBuilder.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ============================================================
   SECCIÓN 5: HELPERS DE INTERFAZ
   ============================================================ */

/**
 * Muestra u oculta el overlay de carga.
 * @param {boolean} show
 */
function setLoading(show) {
  loadingOverlay.classList.toggle('active', show);
}

/**
 * Muestra un toast de notificación que desaparece automáticamente.
 *
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration - Duración en ms (defecto 4000)
 */
function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<span aria-hidden="true">${icons[type]}</span> ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

/**
 * Capitaliza la primera letra de un string.
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ============================================================
   SECCIÓN 6: INICIALIZACIÓN
   ============================================================ */

function init() {
  // Registrar eventos
  btnBattle.addEventListener('click', handleBattle);
  btnRematch.addEventListener('click', handleRematch);
  btnChangeTeam.addEventListener('click', handleChangeTeam);

  pokedexSearch.addEventListener('input', e => {
    searchQuery = e.target.value;
    renderPokedex();
  });

  // Iniciar carga del Pokédex completo
  loadAllPokemon();

  console.log('🚀 Pokémon Battle Arena iniciado correctamente.');
}

init();
