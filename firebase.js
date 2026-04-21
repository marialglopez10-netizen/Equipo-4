/* ============================================
   FIREBASE.JS — Configuración e integración
   con Firebase y Cloud Firestore.

   Este módulo se encarga de:
   1. Inicializar Firebase con las credenciales del proyecto
   2. Guardar resultados de batalla en Firestore
      (equipo del jugador + rivales + resultados)
   ============================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ============================================
   CONFIGURACIÓN DE FIREBASE
   ============================================ */
const firebaseConfig = {
  apiKey:            "AIzaSyAj9P6TeZqRn_zgoShdWoRglVhQ_NpBv1w",
  authDomain:        "equipo4-174fb.firebaseapp.com",
  projectId:         "equipo4-174fb",
  storageBucket:     "equipo4-174fb.firebasestorage.app",
  messagingSenderId: "790679534407",
  appId:             "1:790679534407:web:a9e1964da0ad97a47cea62",
  measurementId:     "G-Y0RTMMK1MX"
};

// Inicializar Firebase y Firestore
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Colección en Firestore
const COLLECTION_NAME = 'battle_results';

/* ============================================
   FUNCIÓN PRINCIPAL: GUARDAR RESULTADO DE BATALLA
   ============================================ */

/**
 * Guarda el resultado completo de un combate en Firestore.
 *
 * Estructura del documento:
 * {
 *   createdAt: Timestamp,
 *   generation: 1,
 *   budget: 1000,
 *   playerTeam: {
 *     totalAttack: number,
 *     totalCost: number,
 *     pokemons: [{ id, name, image, types, attack, cost, totalStats }]
 *   },
 *   rivals: [
 *     {
 *       rivalNumber: number,
 *       totalAttack: number,
 *       result: 'win' | 'loss' | 'tie',
 *       pokemons: [{ id, name, image, attack }]
 *     }
 *   ],
 *   summary: { wins, losses, ties }
 * }
 *
 * @param {Array}  myTeam      - Pokémon del jugador (máx 6)
 * @param {Array}  rivalTeams  - Array de 4 equipos rivales
 * @param {number} myAttack    - Ataque total del jugador
 * @returns {Object} Referencia del documento guardado
 * @throws {Error} Si falla la escritura en Firestore
 */
export async function saveBattleResult(myTeam, rivalTeams, myAttack) {
  try {
    // Calcular resultado por rival
    const rivalsData = rivalTeams.map((team, i) => {
      const rivalAttack = team.reduce((sum, p) => sum + p.attack, 0);
      const result = myAttack > rivalAttack ? 'win'
                   : myAttack < rivalAttack ? 'loss'
                   : 'tie';
      return {
        rivalNumber: i + 1,
        totalAttack: rivalAttack,
        result,
        pokemons: team.map(p => ({
          id:     p.id,
          name:   p.name,
          image:  p.image,
          attack: p.attack
        }))
      };
    });

    // Resumen de victorias/derrotas/empates
    const summary = {
      wins:   rivalsData.filter(r => r.result === 'win').length,
      losses: rivalsData.filter(r => r.result === 'loss').length,
      ties:   rivalsData.filter(r => r.result === 'tie').length
    };

    const docData = {
      createdAt:  Timestamp.now(),
      generation: 1,
      budget:     1000,
      playerTeam: {
        totalAttack: myAttack,
        totalCost:   myTeam.reduce((s, p) => s + p.cost, 0),
        pokemons:    myTeam.map(p => ({
          id:         p.id,
          name:       p.name,
          image:      p.image,
          types:      p.types,
          attack:     p.attack,
          cost:       p.cost,
          totalStats: p.totalStats
        }))
      },
      rivals: rivalsData,
      summary
    };

    const docRef = await addDoc(collection(db, COLLECTION_NAME), docData);
    console.log('✅ Resultado de batalla guardado en Firestore. ID:', docRef.id);
    console.log(`   Resumen: ${summary.wins}W / ${summary.losses}L / ${summary.ties}T`);
    return docRef;

  } catch (error) {
    console.error('❌ Error al guardar en Firestore:', error);
    throw new Error(
      'No se pudo guardar el resultado en Firebase. ' +
      'Verifica tu conexión y credenciales.'
    );
  }
}
