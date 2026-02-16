require('dotenv').config();
const axios = require('axios');
const { runQuery, getDatabase } = require('../src/utils/database');

const SCRYFALL_API = 'https://api.scryfall.com';
const RATE_LIMIT_DELAY = 100; // ms between requests

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchStandardSets() {
  console.log('Fetching Standard sets from Scryfall...');
  
  const response = await axios.get(`${SCRYFALL_API}/sets`);
  const sets = response.data.data;
  
  // Filter for Standard-legal sets
  // Standard typically includes sets from the last 2-3 years
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 3);
  
  const standardSets = sets.filter(set => {
    const releaseDate = new Date(set.released_at);
    return releaseDate > twoYearsAgo && 
           ['core', 'expansion', 'draft_innovation'].includes(set.set_type);
  });
  
  console.log(`Found ${standardSets.length} potential Standard sets`);
  return standardSets.map(s => s.code);
}

async function fetchCardsFromSet(setCode) {
  console.log(`Fetching cards from set: ${setCode}`);
  
  const cards = [];
  let hasMore = true;
  let page = 1;
  
  while (hasMore && page <= 10) { // Limit to 10 pages per set
    try {
      const response = await axios.get(
        `${SCRYFALL_API}/cards/search`,
        {
          params: {
            q: `set:${setCode}`,
            page: page,
            unique: 'cards'
          }
        }
      );
      
      cards.push(...response.data.data);
      hasMore = response.data.has_more;
      page++;
      
      await delay(RATE_LIMIT_DELAY);
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`No more cards for set ${setCode}`);
        hasMore = false;
      } else {
        console.error(`Error fetching page ${page}:`, error.message);
        hasMore = false;
      }
    }
  }
  
  return cards;
}

async function fetchStandardCards() {
  console.log('Fetching Standard-legal cards from Scryfall...');
  
  const cards = [];
  let hasMore = true;
  let page = 1;
  
  // Use Scryfall's format search
  while (hasMore && page <= 50) { // Reasonable limit
    try {
      const response = await axios.get(
        `${SCRYFALL_API}/cards/search`,
        {
          params: {
            q: 'format:standard',
            page: page,
            unique: 'cards',
            include_extras: false,
            include_variations: false
          }
        }
      );
      
      cards.push(...response.data.data);
      hasMore = response.data.has_more;
      page++;
      
      console.log(`Fetched ${cards.length} cards so far...`);
      await delay(RATE_LIMIT_DELAY);
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error.message);
      hasMore = false;
    }
  }
  
  return cards;
}

async function insertCard(card) {
  // Skip non-game cards
  if (card.set_type === 'memorabilia' || card.set_type === 'token') {
    return;
  }
  
  // Skip digital-only cards that aren't on Arena
  if (card.digital && !card.games?.includes('arena')) {
    return;
  }
  
  try {
    await runQuery(
      `INSERT OR REPLACE INTO cards (
        id, oracle_id, name, mana_cost, cmc, type_line, oracle_text,
        colors, color_identity, set_code, set_name, rarity, collector_number,
        power, toughness, loyalty, keywords, legalities, image_uris, prices, released_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        card.id,
        card.oracle_id,
        card.name,
        card.mana_cost || null,
        card.cmc || 0,
        card.type_line || '',
        card.oracle_text || '',
        JSON.stringify(card.colors || []),
        JSON.stringify(card.color_identity || []),
        card.set,
        card.set_name,
        card.rarity,
        card.collector_number,
        card.power || null,
        card.toughness || null,
        card.loyalty || null,
        JSON.stringify(card.keywords || []),
        JSON.stringify(card.legalities || {}),
        JSON.stringify(card.image_uris || {}),
        JSON.stringify(card.prices || {}),
        card.released_at
      ]
    );
  } catch (error) {
    console.error(`Error inserting card ${card.name}:`, error.message);
  }
}

async function updateFTSIndex() {
  console.log('FTS index disabled - using regular search');
  // FTS disabled due to SQLite corruption issues
}

async function syncScryfall() {
  console.log('=== Starting Scryfall Sync ===');
  console.log(`Started at: ${new Date().toISOString()}`);
  
  try {
    // Ensure database is initialized
    const db = getDatabase();
    
    // Fetch all Standard-legal cards
    const cards = await fetchStandardCards();
    
    if (cards.length === 0) {
      console.error('No cards fetched. Check Scryfall API status.');
      process.exit(1);
    }
    
    console.log(`\nProcessing ${cards.length} cards...`);
    
    // Insert cards
    let inserted = 0;
    let errors = 0;
    
    for (const card of cards) {
      try {
        await insertCard(card);
        inserted++;
        
        if (inserted % 100 === 0) {
          console.log(`Inserted ${inserted}/${cards.length} cards...`);
        }
      } catch (error) {
        errors++;
        console.warn(`Failed to insert ${card.name}:`, error.message);
      }
    }
    
    console.log(`\nInserted ${inserted} cards (${errors} errors)`);
    
    // Update FTS index
    await updateFTSIndex();
    
    // Print stats
    const stats = await getDatabase().get('SELECT COUNT(*) as total FROM cards');
    console.log(`\nTotal cards in database: ${stats.total}`);
    
    console.log('\n=== Sync Complete ===');
    console.log(`Finished at: ${new Date().toISOString()}`);
    
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nSync interrupted');
  process.exit(0);
});

// Run sync
syncScryfall();
