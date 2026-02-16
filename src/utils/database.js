const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../database/mtg.db');

let db = null;

function getDatabase() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database');
      }
    });
    
    // Enable foreign keys and WAL mode for better performance
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');
  }
  return db;
}

function closeDatabase() {
  if (db) {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database connection closed');
      }
    });
    db = null;
  }
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

async function initializeDatabase() {
  const database = getDatabase();
  
  // Cards table - stores all MTG card data from Scryfall
  await runQuery(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      oracle_id TEXT,
      name TEXT NOT NULL,
      mana_cost TEXT,
      cmc REAL,
      type_line TEXT,
      oracle_text TEXT,
      colors TEXT, -- JSON array
      color_identity TEXT, -- JSON array
      set_code TEXT,
      set_name TEXT,
      rarity TEXT,
      collector_number TEXT,
      power TEXT,
      toughness TEXT,
      loyalty TEXT,
      keywords TEXT, -- JSON array
      legalities TEXT, -- JSON object
      image_uris TEXT, -- JSON object
      prices TEXT, -- JSON object
      released_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create indexes for cards
  await runQuery('CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_cards_oracle_id ON cards(oracle_id)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_code)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_cards_cmc ON cards(cmc)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type_line)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_cards_legalities ON cards(legalities)');
  
  // Note: FTS disabled due to SQLite corruption issues
  // Using regular LIKE queries for search instead
  
  // Decks table
  await runQuery(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      format TEXT DEFAULT 'standard',
      description TEXT,
      color_identity TEXT, -- JSON array
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      tags TEXT -- JSON array
    )
  `);
  
  // Deck cards table (mainboard and sideboard)
  await runQuery(`
    CREATE TABLE IF NOT EXISTS deck_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id TEXT NOT NULL,
      card_name TEXT NOT NULL,
      card_id TEXT,
      quantity INTEGER DEFAULT 1,
      board TEXT DEFAULT 'main', -- 'main' or 'sideboard'
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id)
    )
  `);
  
  await runQuery('CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_deck_cards_name ON deck_cards(card_name)');
  
  // Untapped.gg profiles
  await runQuery(`
    CREATE TABLE IF NOT EXISTS untapped_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      last_synced TEXT,
      stats TEXT, -- JSON object with win rates, etc.
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Untapped.gg match history
  await runQuery(`
    CREATE TABLE IF NOT EXISTS untapped_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      match_id TEXT UNIQUE,
      opponent TEXT,
      result TEXT, -- 'win', 'loss', 'draw'
      deck_used TEXT,
      opponent_deck TEXT,
      format TEXT,
      duration INTEGER, -- in seconds
      played_at TEXT,
      metadata TEXT, -- JSON object
      FOREIGN KEY (profile_id) REFERENCES untapped_profiles(id) ON DELETE CASCADE
    )
  `);
  
  await runQuery('CREATE INDEX IF NOT EXISTS idx_matches_profile ON untapped_matches(profile_id)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_matches_deck ON untapped_matches(deck_used)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_matches_date ON untapped_matches(played_at)');
  
  // Untapped.gg decks from profile
  await runQuery(`
    CREATE TABLE IF NOT EXISTS untapped_decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      deck_name TEXT NOT NULL,
      format TEXT,
      colors TEXT, -- JSON array
      win_rate REAL,
      matches_played INTEGER,
      last_played TEXT,
      card_list TEXT, -- JSON object with card names and quantities
      sync_date TEXT,
      FOREIGN KEY (profile_id) REFERENCES untapped_profiles(id) ON DELETE CASCADE
    )
  `);
  
  await runQuery('CREATE INDEX IF NOT EXISTS idx_untapped_decks_profile ON untapped_decks(profile_id)');
  
  // Synergy patterns table for deck analysis
  await runQuery(`
    CREATE TABLE IF NOT EXISTS synergy_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pattern_type TEXT, -- 'keyword', 'tribal', 'mechanic', 'archetype'
      keywords TEXT, -- JSON array of matching keywords
      oracle_patterns TEXT, -- JSON array of regex patterns for oracle text
      type_patterns TEXT, -- JSON array of patterns for type line
      description TEXT,
      weight REAL DEFAULT 1.0
    )
  `);
  
  // Insert default synergy patterns
  await insertDefaultSynergyPatterns();
  
  console.log('Database schema initialized');
}

async function insertDefaultSynergyPatterns() {
  const patterns = [
    // Keywords
    { name: 'Eerie', type: 'keyword', keywords: ['["Eerie"]'], desc: 'Triggers when enchantments enter' },
    { name: 'Renown', type: 'keyword', keywords: ['["Renown"]'], desc: 'Counters on dealing combat damage' },
    { name: 'Exploit', type: 'keyword', keywords: ['["Exploit"]'], desc: 'Sacrifice creatures for value' },
    { name: 'Delirium', type: 'keyword', keywords: ['["Delirium"]'], desc: 'Benefits from 4+ card types in graveyard' },
    
    // Tribal
    { name: 'Elves', type: 'tribal', type_patterns: ['["Elf"]'], desc: 'Elf creature synergy' },
    { name: 'Goblins', type: 'tribal', type_patterns: ['["Goblin"]'], desc: 'Goblin creature synergy' },
    { name: 'Merfolk', type: 'tribal', type_patterns: ['["Merfolk"]'], desc: 'Merfolk creature synergy' },
    { name: 'Zombies', type: 'tribal', type_patterns: ['["Zombie"]'], desc: 'Zombie creature synergy' },
    { name: 'Vampires', type: 'tribal', type_patterns: ['["Vampire"]'], desc: 'Vampire creature synergy' },
    { name: 'Angels', type: 'tribal', type_patterns: ['["Angel"]'], desc: 'Angel creature synergy' },
    { name: 'Dragons', type: 'tribal', type_patterns: ['["Dragon"]'], desc: 'Dragon creature synergy' },
    
    // Mechanics
    { name: 'Energy', type: 'mechanic', oracle_patterns: ['["{E}", "energy counter"]'], desc: 'Energy counter mechanics' },
    { name: 'Proliferate', type: 'mechanic', keywords: ['["Proliferate"]'], desc: 'Add counters to permanents/players' },
    { name: 'Modified', type: 'mechanic', keywords: ['["Modified"]'], desc: 'Enchanted, equipped, or has counters' },
    
    // Archetypes
    { name: 'Lifegain', type: 'archetype', oracle_patterns: ['["gain life", "gains life", "lifelink"]'], desc: 'Life gain matters' },
    { name: 'Sacrifice', type: 'archetype', oracle_patterns: ['["sacrifice", "sacrifices"]'], desc: 'Sacrifice for value' },
    { name: 'Tokens', type: 'archetype', oracle_patterns: ['["token", "tokens"]'], desc: 'Create and populate tokens' },
    { name: 'Graveyard', type: 'archetype', oracle_patterns: ['["graveyard", "from your graveyard"]'], desc: 'Graveyard recursion/matters' },
    { name: 'Artifacts Matter', type: 'archetype', oracle_patterns: ['["artifact", "artifacts"]'], desc: 'Artifact synergy' },
    { name: 'Enchantments Matter', type: 'archetype', oracle_patterns: ['["enchantment", "enchantments"]'], desc: 'Enchantment synergy' },
    { name: 'Instants/Sorceries Matter', type: 'archetype', oracle_patterns: ['["instant", "sorcery"]'], desc: 'Spells matter' }
  ];
  
  for (const p of patterns) {
    await runQuery(
      `INSERT OR IGNORE INTO synergy_patterns 
       (name, pattern_type, keywords, oracle_patterns, type_patterns, description) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [p.name, p.type, p.keywords || '[]', p.oracle_patterns || '[]', p.type_patterns || '[]', p.desc]
    );
  }
}

module.exports = {
  getDatabase,
  closeDatabase,
  runQuery,
  getQuery,
  allQuery,
  initializeDatabase
};
