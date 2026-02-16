const { runQuery, getQuery, allQuery } = require('../utils/database');
const cardService = require('./cardService');

async function listDecks({ format, limit, offset }) {
  let sql = `
    SELECT 
      d.id, d.name, d.format, d.description, d.color_identity,
      d.created_at, d.updated_at, d.tags,
      COUNT(dc.id) as card_count
    FROM decks d
    LEFT JOIN deck_cards dc ON d.id = dc.deck_id AND dc.board = 'main'
    WHERE 1=1
  `;
  
  const params = [];
  
  if (format) {
    sql += ` AND d.format = ?`;
    params.push(format);
  }
  
  sql += ` GROUP BY d.id ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const decks = await allQuery(sql, params);
  
  // Get total count
  const countSql = `SELECT COUNT(*) as total FROM decks ${format ? 'WHERE format = ?' : ''}`;
  const countResult = await getQuery(countSql, format ? [format] : []);
  
  return {
    total: countResult.total,
    limit,
    offset,
    decks: decks.map(d => ({
      ...d,
      color_identity: safeJsonParse(d.color_identity, []),
      tags: safeJsonParse(d.tags, [])
    }))
  };
}

async function createDeck({ id, name, format, cards, sideboard, description, tags }) {
  // Calculate color identity from cards
  const cardNames = [...cards, ...sideboard].map(c => c.name);
  const cardData = await cardService.getCardsByNames(cardNames);
  
  const colorIdentity = new Set();
  cardData.forEach(card => {
    if (card.color_identity) {
      card.color_identity.forEach(c => colorIdentity.add(c));
    }
  });
  
  // Insert deck
  await runQuery(
    `INSERT INTO decks (id, name, format, description, color_identity, tags, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, name, format, description || null, JSON.stringify([...colorIdentity]), JSON.stringify(tags || [])]
  );
  
  // Insert main deck cards
  for (const card of cards) {
    const cardInfo = cardData.find(c => c.name.toLowerCase() === card.name.toLowerCase());
    await runQuery(
      `INSERT INTO deck_cards (deck_id, card_name, card_id, quantity, board)
       VALUES (?, ?, ?, ?, 'main')`,
      [id, card.name, cardInfo?.id || null, card.quantity || 1]
    );
  }
  
  // Insert sideboard cards
  for (const card of sideboard) {
    const cardInfo = cardData.find(c => c.name.toLowerCase() === card.name.toLowerCase());
    await runQuery(
      `INSERT INTO deck_cards (deck_id, card_name, card_id, quantity, board)
       VALUES (?, ?, ?, ?, 'sideboard')`,
      [id, card.name, cardInfo?.id || null, card.quantity || 1]
    );
  }
  
  return getDeckById(id);
}

async function getDeckById(id) {
  const deck = await getQuery(
    `SELECT id, name, format, description, color_identity, tags, created_at, updated_at
     FROM decks WHERE id = ?`,
    [id]
  );
  
  if (!deck) return null;
  
  // Get main deck cards
  const mainCards = await allQuery(
    `SELECT dc.card_name, dc.quantity, dc.card_id,
            c.mana_cost, c.cmc, c.type_line, c.colors, c.rarity, c.image_uris
     FROM deck_cards dc
     LEFT JOIN cards c ON dc.card_id = c.id
     WHERE dc.deck_id = ? AND dc.board = 'main'`,
    [id]
  );
  
  // Get sideboard cards
  const sideboardCards = await allQuery(
    `SELECT dc.card_name, dc.quantity, dc.card_id,
            c.mana_cost, c.cmc, c.type_line, c.colors, c.rarity, c.image_uris
     FROM deck_cards dc
     LEFT JOIN cards c ON dc.card_id = c.id
     WHERE dc.deck_id = ? AND dc.board = 'sideboard'`,
    [id]
  );
  
  return {
    ...deck,
    color_identity: safeJsonParse(deck.color_identity, []),
    tags: safeJsonParse(deck.tags, []),
    cards: mainCards.map(c => ({
      name: c.card_name,
      quantity: c.quantity,
      card_id: c.card_id,
      mana_cost: c.mana_cost,
      cmc: c.cmc,
      type_line: c.type_line,
      colors: safeJsonParse(c.colors, []),
      rarity: c.rarity,
      image_uris: safeJsonParse(c.image_uris, {})
    })),
    sideboard: sideboardCards.map(c => ({
      name: c.card_name,
      quantity: c.quantity,
      card_id: c.card_id,
      mana_cost: c.mana_cost,
      cmc: c.cmc,
      type_line: c.type_line,
      colors: safeJsonParse(c.colors, []),
      rarity: c.rarity,
      image_uris: safeJsonParse(c.image_uris, {})
    }))
  };
}

async function updateDeck(id, { name, format, cards, sideboard, description, tags }) {
  // Get existing deck
  const existing = await getDeckById(id);
  if (!existing) throw new Error('Deck not found');
  
  // Calculate color identity if cards changed
  let colorIdentity = existing.color_identity;
  if (cards || sideboard) {
    const cardNames = [
      ...(cards || existing.cards).map(c => c.name),
      ...(sideboard || existing.sideboard).map(c => c.name)
    ];
    const cardData = await cardService.getCardsByNames(cardNames);
    
    const newColorIdentity = new Set();
    cardData.forEach(card => {
      if (card.color_identity) {
        card.color_identity.forEach(c => newColorIdentity.add(c));
      }
    });
    colorIdentity = [...newColorIdentity];
  }
  
  // Update deck metadata
  await runQuery(
    `UPDATE decks 
     SET name = COALESCE(?, name),
         format = COALESCE(?, format),
         description = COALESCE(?, description),
         color_identity = COALESCE(?, color_identity),
         tags = COALESCE(?, tags),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [name, format, description, JSON.stringify(colorIdentity), tags ? JSON.stringify(tags) : null, id]
  );
  
  // Update cards if provided
  if (cards || sideboard) {
    // Delete existing cards
    await runQuery('DELETE FROM deck_cards WHERE deck_id = ?', [id]);
    
    // Re-insert cards
    const cardNames = [...(cards || existing.cards), ...(sideboard || existing.sideboard)]
      .map(c => c.name);
    const cardData = await cardService.getCardsByNames(cardNames);
    
    // Insert main deck
    for (const card of cards || existing.cards) {
      const cardInfo = cardData.find(c => c.name.toLowerCase() === card.name.toLowerCase());
      await runQuery(
        `INSERT INTO deck_cards (deck_id, card_name, card_id, quantity, board)
         VALUES (?, ?, ?, ?, 'main')`,
        [id, card.name, cardInfo?.id || null, card.quantity || 1]
      );
    }
    
    // Insert sideboard
    for (const card of sideboard || existing.sideboard) {
      const cardInfo = cardData.find(c => c.name.toLowerCase() === card.name.toLowerCase());
      await runQuery(
        `INSERT INTO deck_cards (deck_id, card_name, card_id, quantity, board)
         VALUES (?, ?, ?, ?, 'sideboard')`,
        [id, card.name, cardInfo?.id || null, card.quantity || 1]
      );
    }
  }
  
  return getDeckById(id);
}

async function deleteDeck(id) {
  await runQuery('DELETE FROM decks WHERE id = ?', [id]);
}

function safeJsonParse(json, defaultValue) {
  try {
    return json ? JSON.parse(json) : defaultValue;
  } catch {
    return defaultValue;
  }
}

module.exports = {
  listDecks,
  createDeck,
  getDeckById,
  updateDeck,
  deleteDeck
};
