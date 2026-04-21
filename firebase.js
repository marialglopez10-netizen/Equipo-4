/* ============================================
   FIREBASE.JS — Configuración e integración
   con Firebase y Cloud Firestore.
   
   Este módulo se encarga de:
   1. Inicializar Firebase con las credenciales del proyecto
   2. Proveer funciones para guardar generaciones en Firestore
   3. Proveer funciones para recuperar la última generación
   ============================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ============================================
   CONFIGURACIÓN DE FIREBASE
   
   ⚠️ IMPORTANTE: Reemplaza estos valores con
   las credenciales de TU proyecto de Firebase.
   
   Para obtenerlas:
   1. Ve a https://console.firebase.google.com/
   2. Crea un proyecto o selecciona uno existente
   3. Ve a Configuración del proyecto > General
   4. En "Tus apps", registra una app web
   5. Copia los valores del objeto firebaseConfig
   
   También debes:
   - Crear una base de datos en Cloud Firestore
   - En las reglas de Firestore, permite lectura/escritura
     (al menos para desarrollo)
   ============================================ */
const firebaseConfig = {

  apiKey: "AIzaSyAj9P6TeZqRn_zgoShdWoRglVhQ_NpBv1w",

  authDomain: "equipo4-174fb.firebaseapp.com",

  projectId: "equipo4-174fb",

  storageBucket: "equipo4-174fb.firebasestorage.app",

  messagingSenderId: "790679534407",

  appId: "1:790679534407:web:a9e1964da0ad97a47cea62",

  measurementId: "G-Y0RTMMK1MX"

};


// Inicializar Firebase y Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Nombre de la colección en Firestore
const COLLECTION_NAME = 'team_generations';

/* ============================================
   FUNCIONES DE FIRESTORE
   ============================================ */

/**
 * Guarda una generación de equipos en Firestore.
 * 
 * @param {Array} teams - Array de 6 equipos, cada uno con sus Pokémon
 * @returns {Object} - Referencia del documento creado
 * @throws {Error} - Si falla la escritura en Firestore
 */
export async function saveTeamGeneration(teams) {
  try {
    // Construir el documento según el modelo de datos establecido
    const docData = {
      createdAt: Timestamp.now(),
      generation: 1,           // Primera generación de Pokémon
      totalTeams: teams.length,
      teams: teams.map((team, index) => ({
        teamNumber: index + 1,
        pokemons: team.map(pokemon => ({
          id: pokemon.id,
          name: pokemon.name,
          image: pokemon.image,
          types: pokemon.types
        }))
      }))
    };

    // Guardar en Firestore
    const docRef = await addDoc(collection(db, COLLECTION_NAME), docData);
    console.log('Generación guardada en Firestore con ID:', docRef.id);
    return docRef;
  } catch (error) {
    console.error('Error al guardar en Firestore:', error);
    throw new Error('No se pudo guardar la generación en Firebase. Verifica tu conexión y credenciales.');
  }
}

/**
 * Recupera la última generación de equipos guardada en Firestore.
 * Ordena por fecha de creación descendente y toma solo el primer resultado.
 * 
 * @returns {Object|null} - Datos de la última generación, o null si no hay ninguna
 * @throws {Error} - Si falla la lectura desde Firestore
 */
export async function loadLastGeneration() {
  try {
    // Crear consulta: ordenar por fecha descendente, limitar a 1
    const q = query(
      collection(db, COLLECTION_NAME),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const querySnapshot = await getDocs(q);

    // Si no hay documentos, retornar null
    if (querySnapshot.empty) {
      console.log('ℹ No hay generaciones previas en Firestore.');
      return null;
    }

    // Extraer el primer (y único) documento
    const doc = querySnapshot.docs[0];
    const data = doc.data();

    console.log('Última generación cargada desde Firestore:', doc.id);

    return {
      id: doc.id,
      ...data,
      // Convertir Timestamp a fecha legible
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date()
    };
  } catch (error) {
    console.error('Error al cargar desde Firestore:', error);
    throw new Error('No se pudo cargar el último resultado desde Firebase. Verifica tu conexión y credenciales.');
  }
}
