const { allQuery, getQuery } = require('../utils/database');

async function searchCards(params) {
  const { query, colors, type, cmc, cmcMin, cmcMax, rarity, set, legalIn, limit, offset } = params;
  
  let sql = `
    SELECT 
      c.id, c.oracle_id, c.name, c.mana_cost, c.cmc, c.type_line,
      c.oracle_text, c.colors, c.color_identity, c.set_code, c.set_name,
      c.rarity, c.power, c.toughness, c.loyalty, c.keywords,
      c.image_uris, c.prices, c.legalities, c.released_at
    FROM cards c
    WHERE 1=1
  `;
  
  const conditions = [];
  const queryParams = [];
  
  // Text search (name or oracle text)
  if (query) {
    conditions.push(`(
      c.name LIKE ? OR 
      c.oracle_text LIKE ? OR 
      c.type_line LIKE ?
    )`);
    const searchTerm = `%${query}%`;
    queryParams.push(searchTerm, searchTerm, searchTerm);
  }
  
  // Color filter
  if (colors && colors.length > 0) {
    conditions.push(`c.color_identity LIKE ?`);
    queryParams.push(`%${colors.join('%')}%`);
  }
  
  // Type filter
  if (type) {
    conditions.push(`c.type_line LIKE ?`);
    queryParams.push(`%${type}%`);
  }
  
  // CMC filters
  if (cmc !== undefined) {
    conditions.push(`c.cmc = ?`);
    queryParams.push(cmc);
  }
  if (cmcMin !== undefined) {
    conditions.push(`c.cmc >= ?`);
    queryParams.push(cmcMin);
  }
  if (cmcMax !== undefined) {
    conditions.push(`c.cmc <= ?`);
    queryParams.push(cmcMax);
  }
  
  // Rarity filter
  if (rarity) {
    conditions.push(`c.rarity = ?`);
    queryParams.push(rarity.toLowerCase());
  }
  
  // Set filter
  if (set) {
    conditions.push(`c.set_code = ?`);
    queryParams.push(set.toLowerCase());
  }
  
  // Legality filter
  if (legalIn) {
    conditions.push(`c.legalities LIKE ?`);
    queryParams.push(`%"${legalIn}": "legal"%`);
  }
  
  if (conditions.length > 0) {
    sql += ' AND ' + conditions.join(' AND ');
  }
  
  // Count total
  const countSql = `SELECT COUNT(*) as total FROM cards c WHERE 1=1 ${conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : ''}`;
  const countResult = await getQuery(countSql, queryParams);
  
  // Add ordering and pagination
  sql += ` ORDER BY c.cmc ASC, c.name ASC LIMIT ? OFFSET ?`;
  queryParams.push(limit, offset);
  
  const cards = await allQuery(sql, queryParams);
  
  // Parse JSON columns
  const parsedCards = cards.map(card => parseCardJson(card));
  
  return {
    total: countResult.total,
    cards: parsedCards
  };
}

async function listCards(params) {
  return searchCards({ ...params, query: undefined });
}

async function getCardByName(name) {
  const card = await getQuery(
    `SELECT 
      id, oracle_id, name, mana_cost, cmc, type_line,
      oracle_text, colors, color_identity, set_code, set_name,
      rarity, power, toughness, loyalty, keywords,
      image_uris, prices, legalities, released_at
    FROM cards 
    WHERE LOWER(name) = LOWER(?)`,
    [name]
  );
  
  if (!card) return null;
  
  return parseCardJson(card);
}

async function getCardById(id) {
  const card = await getQuery(
    `SELECT 
      id, oracle_id, name, mana_cost, cmc, type_line,
      oracle_text, colors, color_identity, set_code, set_name,
      rarity, power, toughness, loyalty, keywords,
      image_uris, prices, legalities, released_at
    FROM cards 
    WHERE id = ?`,
    [id]
  );
  
  if (!card) return null;
  
  return parseCardJson(card);
}

async function getCardsByNames(names) {
  if (!names || names.length === 0) return [];
  
  const placeholders = names.map(() => '?').join(',');
  const cards = await allQuery(
    `SELECT 
      id, oracle_id, name, mana_cost, cmc, type_line,
      oracle_text, colors, color_identity, set_code, set_name,
      rarity, power, toughness, loyalty, keywords,
      image_uris, prices, legalities, released_at
    FROM cards 
    WHERE LOWER(name) IN (${placeholders})`,
    names.map(n => n.toLowerCase())
  );
  
  return cards.map(card => parseCardJson(card));
}

async function getStandardLegalSets() {
  const sets = await allQuery(
    `SELECT DISTINCT set_code, set_name 
     FROM cards 
     WHERE legalities LIKE '%"standard": "legal"%'
     ORDER BY released_at DESC`
  );
  return sets;
}

function parseCardJson(card) {
  if (!card) return null;
  
  return {
    ...card,
    colors: safeJsonParse(card.colors, []),
    color_identity: safeJsonParse(card.color_identity, []),
    keywords: safeJsonParse(card.keywords, []),
    legalities: safeJsonParse(card.legalities, {}),
    image_uris: safeJsonParse(card.image_uris, {}),
    prices: safeJsonParse(card.prices, {})
  };
}

function safeJsonParse(json, defaultValue) {
  try {
    return json ? JSON.parse(json) : defaultValue;
  } catch {
    return defaultValue;
  }
}

module.exports = {
  searchCards,
  listCards,
  getCardByName,
  getCardById,
  getCardsByNames,
  getStandardLegalSets,
  parseCardJson
};
