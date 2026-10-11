import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit,
  Firestore
} from 'firebase/firestore';
import { StudyContent, Series } from '../types';

/**
 * Data store for read cards (history + review) and study series.
 *
 * With Firebase configured (VITE_FIREBASE_* env vars) everything syncs across
 * devices through Firestore, with an on-device cache so it also works offline.
 * Without it, the same API saves to this device only (localStorage), so the
 * app keeps working before Firebase is set up.
 */

export type SyncStatus = 'local' | 'connecting' | 'synced' | 'error';

type Listener<T> = (value: T) => void;

export interface Store {
  mode: 'firebase' | 'local';
  subscribeStatus(cb: Listener<{ status: SyncStatus; message?: string }>): () => void;
  subscribeCards(cb: Listener<StudyContent[]>): () => void;
  subscribeSeries(cb: Listener<Series[]>): () => void;
  saveCardIfNew(card: StudyContent): Promise<void>;
  updateCard(id: string, patch: Partial<StudyContent>): Promise<void>;
  deleteCard(id: string): Promise<void>;
  saveSeries(series: Series): Promise<void>;
  updateSeries(id: string, patch: Partial<Series>): Promise<void>;
  deleteSeries(id: string): Promise<void>;
}

const MAX_CARDS = 300;

// Prefixed so MedDaily can share a Firebase project with other apps
// (e.g. MediNote's `notes`/`appSettings`) without ever touching their data.
const CARDS = 'meddaily_cards';
const SERIES = 'meddaily_series';

// ---------- small helper: a value + listeners ----------
function observable<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener<T>>();
  return {
    get: () => value,
    set(v: T) { value = v; listeners.forEach(l => l(v)); },
    subscribe(cb: Listener<T>) { listeners.add(cb); cb(value); return () => { listeners.delete(cb); }; }
  };
}

// Firestore rejects `undefined`; JSON round-trip drops it (and any functions).
const clean = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

// ===================== Firebase backend =====================
function createFirebaseStore(config: Record<string, string>): Store {
  const status = observable<{ status: SyncStatus; message?: string }>({ status: 'connecting' });
  const cards = observable<StudyContent[]>([]);
  const series = observable<Series[]>([]);
  const knownCardIds = new Set<string>();

  let db: Firestore;
  let ready: Promise<void>;

  try {
    const app = initializeApp(config);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true
    });
    const auth = getAuth(app);
    ready = new Promise<void>((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) { unsub(); resolve(); }
      });
      signInAnonymously(auth).catch((e) => {
        unsub();
        reject(e);
      });
    });
  } catch (e: any) {
    ready = Promise.reject(e);
  }

  ready.then(() => {
    status.set({ status: 'synced' });

    const cardsQuery = query(collection(db, CARDS), orderBy('readAt', 'desc'), limit(MAX_CARDS));
    onSnapshot(cardsQuery, (snap) => {
      const list = snap.docs.map(d => d.data() as StudyContent);
      list.forEach(c => c.id && knownCardIds.add(c.id));
      cards.set(list);
    }, (err) => status.set({ status: 'error', message: err.message }));

    const seriesQuery = query(collection(db, SERIES), orderBy('updatedAt', 'desc'), limit(100));
    onSnapshot(seriesQuery, (snap) => {
      series.set(snap.docs.map(d => d.data() as Series));
    }, (err) => status.set({ status: 'error', message: err.message }));
  }).catch((e: any) => {
    console.error('Firebase init/auth failed', e);
    status.set({ status: 'error', message: e?.code || e?.message || String(e) });
  });

  return {
    mode: 'firebase',
    subscribeStatus: status.subscribe,
    subscribeCards: cards.subscribe,
    subscribeSeries: series.subscribe,

    async saveCardIfNew(card) {
      if (!card.id || knownCardIds.has(card.id)) return;
      await ready;
      const ref = doc(db, CARDS, card.id);
      try {
        const existing = await getDoc(ref);
        if (existing.exists()) { knownCardIds.add(card.id); return; }
      } catch (e) {
        // offline and not in cache: treat as new
      }
      knownCardIds.add(card.id);
      await setDoc(ref, clean(card));
    },
    async updateCard(id, patch) {
      await ready;
      await updateDoc(doc(db, CARDS, id), clean(patch) as any);
    },
    async deleteCard(id) {
      await ready;
      knownCardIds.delete(id);
      await deleteDoc(doc(db, CARDS, id));
    },
    async saveSeries(s) {
      await ready;
      await setDoc(doc(db, SERIES, s.id), clean(s));
    },
    async updateSeries(id, patch) {
      await ready;
      await updateDoc(doc(db, SERIES, id), clean(patch) as any);
    },
    async deleteSeries(id) {
      await ready;
      await deleteDoc(doc(db, SERIES, id));
    }
  };
}

// ===================== Local (this device only) backend =====================
const LOCAL_KEY = 'medDaily_store_v1';

function createLocalStore(): Store {
  const load = (): { cards: Record<string, StudyContent>; series: Record<string, Series> } => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { cards: parsed.cards || {}, series: parsed.series || {} };
      }
    } catch (e) { /* ignore */ }
    return { cards: {}, series: {} };
  };

  let data = load();
  const sortedCards = () => Object.values(data.cards).sort((a, b) => (b.readAt || 0) - (a.readAt || 0)).slice(0, MAX_CARDS);
  const sortedSeries = () => Object.values(data.series).sort((a, b) => b.updatedAt - a.updatedAt);

  const status = observable<{ status: SyncStatus; message?: string }>({ status: 'local' });
  const cards = observable<StudyContent[]>(sortedCards());
  const series = observable<Series[]>(sortedSeries());

  const persist = () => {
    // keep only the newest MAX_CARDS so localStorage doesn't overflow
    const keep = sortedCards();
    data.cards = Object.fromEntries(keep.map(c => [c.id as string, c]));
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Local store save failed', e);
    }
    cards.set(keep);
    series.set(sortedSeries());
  };

  return {
    mode: 'local',
    subscribeStatus: status.subscribe,
    subscribeCards: cards.subscribe,
    subscribeSeries: series.subscribe,
    async saveCardIfNew(card) {
      if (!card.id || data.cards[card.id]) return;
      data.cards[card.id] = clean(card);
      persist();
    },
    async updateCard(id, patch) {
      if (!data.cards[id]) return;
      data.cards[id] = { ...data.cards[id], ...clean(patch) };
      persist();
    },
    async deleteCard(id) {
      delete data.cards[id];
      persist();
    },
    async saveSeries(s) {
      data.series[s.id] = clean(s);
      persist();
    },
    async updateSeries(id, patch) {
      if (!data.series[id]) return;
      data.series[id] = { ...data.series[id], ...clean(patch) };
      persist();
    },
    async deleteSeries(id) {
      delete data.series[id];
      persist();
    }
  };
}

// ===================== pick backend =====================
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || ''
};

export const isFirebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

export const store: Store = isFirebaseConfigured
  ? createFirebaseStore(firebaseConfig)
  : createLocalStore();

export { newId } from './id';
