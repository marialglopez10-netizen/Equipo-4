/* ============================================
   SCRIPT.JS — Lógica principal del Generador
   de Equipos Pokémon.
   
   Responsabilidades:
   - Obtener Pokémon de la primera generación desde PokéAPI
   - Seleccionar aleatoriamente 36 Pokémon únicos
   - Agruparlos en 6 equipos de 6
   - Renderizar los equipos en pantalla
   - Coordinar guardado y carga desde Firebase
   ============================================ */

import { saveTeamGeneration, loadLastGeneration } from './firebase.js';

/* ============================================
   CONSTANTES DE CONFIGURACIÓN
   ============================================ */
const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2';
const TOTAL_TEAMS = 6;            // Número de equipos a generar
const TEAM_SIZE = 6;              // Pokémon por equipo
const TOTAL_POKEMON_NEEDED = TOTAL_TEAMS * TEAM_SIZE; // 36 en total
const GEN1_POKEMON_COUNT = 151;   // Pokémon disponibles en la primera generación

/* ============================================
   REFERENCIAS DEL DOM
   ============================================ */
const btnGenerate = document.getElementById('btn-generate');
const btnLoadLast = document.getElementById('btn-load-last');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingSubtext = document.getElementById('loading-subtext');
const teamsContainer = document.getElementById('teams-container');
const emptyState = document.getElementById('empty-state');
const generationInfo = document.getElementById('generation-info');
const generationDate = document.getElementById('generation-date');
const toastContainer = document.getElementById('toast-container');

/* ============================================================
   SECCIÓN 1: OBTENCIÓN DE DATOS DESDE POKÉAPI
   ============================================================ */

/**
 * Obtiene la lista completa de Pokémon de la primera generación
 * usando el endpoint de generación de PokéAPI.
 * 
 * El endpoint /generation/1 devuelve todas las especies
 * pertenecientes a la primera generación.
 * 
 * @returns {Array} Lista de objetos { name, url } de cada Pokémon Gen 1
 * @throws {Error} Si la petición a PokéAPI falla
 */
async function fetchFirstGenPokemonList() {
  try {
    updateLoadingText('Obteniendo lista de la primera generación...');
    const response = await fetch(`${POKEAPI_BASE_URL}/generation/1`);

    if (!response.ok) {
      throw new Error(`PokéAPI respondió con estado ${response.status}`);
    }

    const data = await response.json();
    const pokemonSpecies = data.pokemon_species;

    // Validar que hay al menos 36 Pokémon disponibles
    if (!pokemonSpecies || pokemonSpecies.length < TOTAL_POKEMON_NEEDED) {
      throw new Error(
        `Se necesitan al menos ${TOTAL_POKEMON_NEEDED} Pokémon, ` +
        `pero solo se encontraron ${pokemonSpecies?.length ?? 0}.`
      );
    }

    console.log(`✅ ${pokemonSpecies.length} Pokémon de Gen 1 obtenidos.`);
    return pokemonSpecies;
  } catch (error) {
    throw new Error(`Error al obtener la lista de Pokémon: ${error.message}`);
  }
}

/**
 * Obtiene los detalles completos de un Pokémon por su nombre.
 * Consulta nombre, ID, sprite oficial y tipos.
 * 
 * @param {string} name - Nombre del Pokémon en minúsculas
 * @returns {Object} Objeto con { id, name, image, types }
 * @throws {Error} Si la petición falla para ese Pokémon específico
 */
async function fetchPokemonDetails(name) {
  const response = await fetch(`${POKEAPI_BASE_URL}/pokemon/${name}`);

  if (!response.ok) {
    throw new Error(`No se pudo obtener detalles de "${name}" (estado ${response.status})`);
  }

  const data = await response.json();

  return {
    id: data.id,
    name: data.name,
    // Usamos el sprite oficial de alta calidad; si no existe, usamos el sprite por defecto
    image:
      data.sprites?.other?.['official-artwork']?.front_default ||
      data.sprites?.front_default ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${data.id}.png`,
    types: data.types.map(t => t.type.name)
  };
}

/**
 * Obtiene los detalles de múltiples Pokémon en paralelo usando Promise.all.
 * Para evitar sobrecargar la API, se procesan en lotes de 10.
 * 
 * @param {Array} pokemonNames - Lista de nombres de Pokémon a consultar
 * @returns {Array} Lista de objetos con detalles de cada Pokémon
 * @throws {Error} Si alguna petición falla
 */
async function fetchMultiplePokemonDetails(pokemonNames) {
  const BATCH_SIZE = 10; // Tamaño del lote para no saturar la API
  const results = [];

  for (let i = 0; i < pokemonNames.length; i += BATCH_SIZE) {
    const batch = pokemonNames.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(pokemonNames.length / BATCH_SIZE);

    updateLoadingText(`Cargando detalles... (lote ${batchNumber} de ${totalBatches})`);

    // Ejecutar las peticiones del lote en paralelo
    const batchResults = await Promise.all(
      batch.map(name => fetchPokemonDetails(name))
    );

    results.push(...batchResults);
  }

  return results;
}

/* ============================================================
   SECCIÓN 2: GENERACIÓN ALEATORIA DE EQUIPOS
   ============================================================ */

/**
 * Extrae el número de ID de un Pokémon a partir de la URL de su especie.
 * Necesario porque el endpoint /generation/1 devuelve URLs de especies,
 * no del Pokémon directamente.
 * 
 * Ejemplo: "https://pokeapi.co/api/v2/pokemon-species/25/" → 25
 * 
 * @param {string} url - URL de la especie del Pokémon
 * @returns {number} ID extraído de la URL
 */
function extractIdFromUrl(url) {
  const parts = url.replace(/\/$/, '').split('/');
  return parseInt(parts[parts.length - 1], 10);
}

/**
 * Selecciona aleatoriamente `count` elementos únicos de un array,
 * ordenados por ID para asegurar que son todos Gen 1 (ID 1-151).
 * Filtra previamente los Pokémon cuyo ID supere el límite de Gen 1.
 * 
 * Usa el algoritmo de Fisher-Yates para una selección verdaderamente aleatoria.
 * 
 * @param {Array} pokemonList - Lista completa de especies de PokéAPI
 * @param {number} count - Cuántos Pokémon seleccionar
 * @returns {Array} Lista de `count` nombres de Pokémon únicos
 */
function selectRandomUniquePokemons(pokemonList, count) {
  // Filtrar para asegurarse de que son Pokémon válidos de Gen 1 (ID 1-151)
  const gen1Pokemon = pokemonList.filter(p => {
    const id = extractIdFromUrl(p.url);
    return id >= 1 && id <= GEN1_POKEMON_COUNT;
  });

  if (gen1Pokemon.length < count) {
    throw new Error(
      `No hay suficientes Pokémon de Gen 1. Se necesitan ${count}, ` +
      `hay ${gen1Pokemon.length} disponibles.`
    );
  }

  // Copia del array para no mutar el original (Fisher-Yates shuffle)
  const shuffled = [...gen1Pokemon];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Tomar los primeros `count` elementos del array mezclado
  return shuffled.slice(0, count).map(p => p.name);
}

/**
 * Agrupa un array plano de Pokémon en equipos de tamaño fijo.
 * 
 * @param {Array} pokemons - Array plano con todos los Pokémon (36 en total)
 * @param {number} teamSize - Tamaño de cada equipo (6)
 * @returns {Array} Array de arrays: [[equipo1], [equipo2], ...]
 */
function groupIntoTeams(pokemons, teamSize) {
  const teams = [];
  for (let i = 0; i < pokemons.length; i += teamSize) {
    teams.push(pokemons.slice(i, i + teamSize));
  }
  return teams;
}

/* ============================================================
   SECCIÓN 3: RENDERIZADO DE LA INTERFAZ
   ============================================================ */

/**
 * Genera el HTML de una tarjeta de Pokémon individual.
 * Incluye ID, imagen, nombre y tipos con sus colores correspondientes.
 * 
 * @param {Object} pokemon - Objeto con { id, name, image, types }
 * @returns {string} HTML de la tarjeta
 */
function createPokemonCardHTML(pokemon) {
  // Generar badges de tipos con los colores correctos
  const typeBadgesHTML = pokemon.types
    .map(type => `<span class="type-badge type-badge--${type}">${type}</span>`)
    .join('');

  // Nombre formateado con primera letra en mayúscula
  const displayName = pokemon.name.charAt(0).toUpperCase() + pokemon.name.slice(1);

  // Número formateado con ceros a la izquierda (ej: #025)
  const displayId = `#${String(pokemon.id).padStart(3, '0')}`;

  return `
    <article class="pokemon-card" data-pokemon-id="${pokemon.id}">
      <p class="pokemon-card__id">${displayId}</p>
      <div class="pokemon-card__image-wrapper">
        <img
          class="pokemon-card__image"
          src="${pokemon.image}"
          alt="${displayName}"
          loading="lazy"
          onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png'"
        >
      </div>
      <h3 class="pokemon-card__name">${displayName}</h3>
      <div class="pokemon-card__types">
        ${typeBadgesHTML}
      </div>
    </article>
  `;
}

/**
 * Genera el HTML de un bloque de equipo completo.
 * Contiene el encabezado del equipo y la cuadrícula de 6 tarjetas Pokémon.
 * 
 * @param {Array} team - Array de 6 objetos Pokémon
 * @param {number} teamIndex - Índice del equipo (0-5), usado para el número
 * @returns {string} HTML del bloque de equipo
 */
function createTeamBlockHTML(team, teamIndex) {
  const teamNumber = teamIndex + 1;
  const pokemonCardsHTML = team.map(createPokemonCardHTML).join('');

  return `
    <section class="team-block" aria-label="Equipo ${teamNumber}">
      <header class="team-header">
        <span class="team-header__number">${teamNumber}</span>
        <h2 class="team-header__label">Equipo ${teamNumber}</h2>
      </header>
      <div class="team-grid">
        ${pokemonCardsHTML}
      </div>
    </section>
  `;
}

/**
 * Renderiza todos los equipos en el contenedor principal del DOM.
 * Limpia el contenedor previo antes de insertar el nuevo contenido.
 * 
 * @param {Array} teams - Array de 6 equipos, cada uno con 6 Pokémon
 */
function renderTeams(teams) {
  // Limpiar contenido previo
  teamsContainer.innerHTML = '';

  // Ocultar estado vacío
  emptyState.style.display = 'none';

  // Generar y añadir HTML de cada equipo
  const teamsHTML = teams.map((team, index) => createTeamBlockHTML(team, index)).join('');
  teamsContainer.innerHTML = teamsHTML;
}

/**
 * Muestra la fecha y hora de la generación guardada.
 * 
 * @param {Date} date - Objeto Date con la fecha de creación
 */
function showGenerationInfo(date) {
  const formattedDate = date.toLocaleString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  generationDate.textContent = formattedDate;
  generationInfo.style.display = 'block';
}

/* ============================================================
   SECCIÓN 4: HELPERS DE INTERFAZ (Loading, Toasts, Botones)
   ============================================================ */

/**
 * Muestra u oculta el indicador de carga.
 * @param {boolean} show - true para mostrar, false para ocultar
 */
function setLoading(show) {
  if (show) {
    loadingOverlay.classList.add('active');
  } else {
    loadingOverlay.classList.remove('active');
  }
}

/**
 * Actualiza el texto secundario del indicador de carga
 * para informar al usuario qué paso se está ejecutando.
 * 
 * @param {string} text - Texto descriptivo del paso actual
 */
function updateLoadingText(text) {
  loadingSubtext.textContent = text;
}

/**
 * Habilita o deshabilita todos los botones de acción.
 * Evita que el usuario haga múltiples solicitudes simultáneas.
 * 
 * @param {boolean} disabled - true para deshabilitar, false para habilitar
 */
function setButtonsDisabled(disabled) {
  btnGenerate.disabled = disabled;
  btnLoadLast.disabled = disabled;
}

/**
 * Muestra un toast de notificación con auto-desaparición.
 * 
 * @param {string} message - Mensaje a mostrar
 * @param {'success'|'error'|'info'} type - Tipo de toast (afecta el color)
 * @param {number} duration - Duración en ms antes de desaparecer (defecto: 4000ms)
 */
function showToast(message, type = 'info', duration = 4000) {
  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<span aria-hidden="true">${icons[type]}</span> ${message}`;

  toastContainer.appendChild(toast);

  // Remover el toast del DOM después de que la animación termina
  setTimeout(() => {
    toast.remove();
  }, duration);
}

/* ============================================================
   SECCIÓN 5: FLUJO PRINCIPAL DE LA APLICACIÓN
   ============================================================ */

/**
 * Maneja el flujo completo de generación de equipos:
 * 1. Deshabilita botones y muestra loading
 * 2. Obtiene lista de Pokémon Gen 1 de PokéAPI
 * 3. Selecciona 36 Pokémon únicos aleatoriamente
 * 4. Obtiene detalles de cada uno
 * 5. Los agrupa en 6 equipos de 6
 * 6. Los renderiza en pantalla
 * 7. Los guarda en Firebase Firestore
 * 8. Muestra confirmación al usuario
 */
async function handleGenerate() {
  // --- Paso 0: Preparar UI para carga ---
  setButtonsDisabled(true);
  setLoading(true);
  teamsContainer.innerHTML = '';
  generationInfo.style.display = 'none';
  emptyState.style.display = 'none';

  try {
    // --- Paso 1: Obtener lista de Pokémon de Gen 1 ---
    const pokemonList = await fetchFirstGenPokemonList();

    // --- Paso 2: Seleccionar 36 Pokémon únicos aleatoriamente ---
    updateLoadingText('Seleccionando Pokémon al azar...');
    const selectedNames = selectRandomUniquePokemons(pokemonList, TOTAL_POKEMON_NEEDED);

    // --- Paso 3: Obtener detalles de los 36 Pokémon seleccionados ---
    const pokemonDetails = await fetchMultiplePokemonDetails(selectedNames);

    // --- Paso 4: Agrupar en 6 equipos de 6 Pokémon ---
    updateLoadingText('Formando equipos...');
    const teams = groupIntoTeams(pokemonDetails, TEAM_SIZE);

    // --- Paso 5: Renderizar en pantalla ---
    renderTeams(teams);

    // --- Paso 6: Guardar en Firebase Firestore ---
    updateLoadingText('Guardando en la nube...');
    await saveTeamGeneration(teams);

    // Mostrar fecha actual como info de la generación
    showGenerationInfo(new Date());
    showToast('¡Equipos generados y guardados correctamente!', 'success');

  } catch (error) {
    // --- Manejo de errores: mostrar mensaje amigable al usuario ---
    console.error('❌ Error durante la generación:', error);
    showToast(`Error: ${error.message}`, 'error', 6000);
    // Restaurar el estado vacío si no se pudieron renderizar equipos
    if (teamsContainer.innerHTML === '') {
      emptyState.style.display = 'block';
    }
  } finally {
    // --- Siempre: ocultar loading y rehabilitar botones ---
    setLoading(false);
    setButtonsDisabled(false);
  }
}

/**
 * Maneja el flujo de carga del último resultado guardado en Firestore:
 * 1. Deshabilita botones y muestra loading
 * 2. Consulta el último documento en Firestore
 * 3. Si existe, extrae los equipos y los renderiza
 * 4. Si no existe, informa al usuario
 */
async function handleLoadLast() {
  // --- Preparar UI ---
  setButtonsDisabled(true);
  setLoading(true);
  updateLoadingText('Cargando desde Firebase...');
  teamsContainer.innerHTML = '';
  generationInfo.style.display = 'none';
  emptyState.style.display = 'none';

  try {
    // --- Consultar Firestore ---
    const lastGeneration = await loadLastGeneration();

    if (!lastGeneration) {
      // No hay generaciones previas en la base de datos
      showToast('No hay generaciones guardadas. ¡Genera la primera!', 'info');
      emptyState.style.display = 'block';
      return;
    }

    // --- Extraer los equipos del documento de Firestore ---
    // El documento tiene teams[].pokemons[], hay que convertirlo al formato
    // que acepta renderTeams: Array de Arrays de objetos Pokémon
    const teams = lastGeneration.teams.map(team => team.pokemons);

    // --- Renderizar en pantalla ---
    renderTeams(teams);
    showGenerationInfo(lastGeneration.createdAt);
    showToast('Último resultado cargado correctamente.', 'success');

  } catch (error) {
    console.error('❌ Error al cargar el último resultado:', error);
    showToast(`Error: ${error.message}`, 'error', 6000);
    emptyState.style.display = 'block';
  } finally {
    setLoading(false);
    setButtonsDisabled(false);
  }
}

/* ============================================================
   SECCIÓN 6: INICIALIZACIÓN Y EVENTOS
   ============================================================ */

/**
 * Inicializa la aplicación:
 * - Registra los listeners de los botones
 * - Muestra el estado inicial (vacío)
 */
function init() {
  // Registrar el evento del botón principal
  btnGenerate.addEventListener('click', handleGenerate);

  // Registrar el evento del botón de carga
  btnLoadLast.addEventListener('click', handleLoadLast);

  // Mostrar estado inicial vacío
  emptyState.style.display = 'block';

  console.log('🚀 Pokémon Team Generator iniciado correctamente.');
}

// Ejecutar la inicialización cuando el módulo carga
init();
