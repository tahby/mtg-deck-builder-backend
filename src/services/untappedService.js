const { runQuery, getQuery, allQuery } = require('../utils/database');
const untappedScraper = require('../scrapers/untappedScraper');

async function syncProfile(username, options = {}) {
  const { syncMatches, syncDecks, headless } = options;
  
  // Scrape profile data
  const scrapedData = await untappedScraper.scrapeProfile(username, {
    syncMatches,
    syncDecks,
    headless
  });
  
  // Get or create profile record
  let profile = await getQuery(
    'SELECT id FROM untapped_profiles WHERE username = ?',
    [username]
  );
  
  const statsJson = JSON.stringify(scrapedData.stats || {});
  
  if (profile) {
    await runQuery(
      `UPDATE untapped_profiles 
       SET display_name = ?,
           avatar_url = ?,
           last_synced = CURRENT_TIMESTAMP,
           stats = ?
       WHERE id = ?`,
      [
        scrapedData.profile.displayName,
        scrapedData.profile.avatarUrl,
        statsJson,
        profile.id
      ]
    );
    profile.id = profile.id;
  } else {
    const result = await runQuery(
      `INSERT INTO untapped_profiles 
       (username, display_name, avatar_url, last_synced, stats)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [
        username,
        scrapedData.profile.displayName,
        scrapedData.profile.avatarUrl,
        statsJson
      ]
    );
    profile = { id: result.id };
  }
  
  // Store matches
  let matchesCount = 0;
  if (syncMatches && scrapedData.matches) {
    for (const match of scrapedData.matches) {
      await runQuery(
        `INSERT OR REPLACE INTO untapped_matches
         (profile_id, match_id, opponent, result, deck_used, opponent_deck,
          format, duration, played_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profile.id,
          match.id,
          match.opponent,
          match.result,
          match.deckUsed,
          match.opponentDeck,
          match.format,
          match.duration,
          match.playedAt,
          JSON.stringify(match.metadata || {})
        ]
      );
      matchesCount++;
    }
  }
  
  // Store decks
  let decksCount = 0;
  if (syncDecks && scrapedData.decks) {
    for (const deck of scrapedData.decks) {
      await runQuery(
        `INSERT OR REPLACE INTO untapped_decks
         (profile_id, deck_name, format, colors, win_rate, matches_played,
          last_played, card_list, sync_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          profile.id,
          deck.name,
          deck.format,
          JSON.stringify(deck.colors || []),
          deck.winRate,
          deck.matchesPlayed,
          deck.lastPlayed,
          JSON.stringify(deck.cardList || {})
        ]
      );
      decksCount++;
    }
  }
  
  return {
    profileId: profile.id,
    matchesSynced: matchesCount,
    decksSynced: decksCount,
    lastSync: new Date().toISOString()
  };
}

async function getProfile(username) {
  const profile = await getQuery(
    `SELECT 
      id, username, display_name, avatar_url, 
      last_synced, stats, created_at
     FROM untapped_profiles 
     WHERE username = ?`,
    [username]
  );
  
  if (!profile) return null;
  
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    lastSynced: profile.last_synced,
    createdAt: profile.created_at,
    stats: safeJsonParse(profile.stats, {})
  };
}

async function getMatches(username, options = {}) {
  const { limit = 50, offset = 0, deck } = options;
  
  const profile = await getQuery(
    'SELECT id FROM untapped_profiles WHERE username = ?',
    [username]
  );
  
  if (!profile) {
    return { error: 'Profile not found' };
  }
  
  let sql = `
    SELECT 
      match_id, opponent, result, deck_used, opponent_deck,
      format, duration, played_at, metadata
    FROM untapped_matches
    WHERE profile_id = ?
  `;
  const params = [profile.id];
  
  if (deck) {
    sql += ` AND deck_used = ?`;
    params.push(deck);
  }
  
  sql += ` ORDER BY played_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const matches = await allQuery(sql, params);
  
  // Get total count
  const countSql = `SELECT COUNT(*) as total FROM untapped_matches WHERE profile_id = ?`;
  const countParams = [profile.id];
  if (deck) {
    countSql += ` AND deck_used = ?`;
    countParams.push(deck);
  }
  const countResult = await getQuery(countSql, countParams);
  
  // Calculate win rate
  const wins = matches.filter(m => m.result === 'win').length;
  const losses = matches.filter(m => m.result === 'loss').length;
  const total = wins + losses;
  
  return {
    total: countResult.total,
    limit,
    offset,
    summary: {
      wins,
      losses,
      draws: matches.filter(m => m.result === 'draw').length,
      winRate: total > 0 ? Math.round((wins / total) * 100) : 0
    },
    matches: matches.map(m => ({
      id: m.match_id,
      opponent: m.opponent,
      result: m.result,
      deckUsed: m.deck_used,
      opponentDeck: m.opponent_deck,
      format: m.format,
      duration: m.duration,
      playedAt: m.played_at,
      metadata: safeJsonParse(m.metadata, {})
    }))
  };
}

async function getDecks(username) {
  const profile = await getQuery(
    'SELECT id FROM untapped_profiles WHERE username = ?',
    [username]
  );
  
  if (!profile) {
    return { error: 'Profile not found' };
  }
  
  const decks = await allQuery(
    `SELECT 
      deck_name, format, colors, win_rate, 
      matches_played, last_played, card_list, sync_date
    FROM untapped_decks
    WHERE profile_id = ?
    ORDER BY last_played DESC`,
    [profile.id]
  );
  
  return {
    total: decks.length,
    decks: decks.map(d => ({
      name: d.deck_name,
      format: d.format,
      colors: safeJsonParse(d.colors, []),
      winRate: d.win_rate,
      matchesPlayed: d.matches_played,
      lastPlayed: d.last_played,
      cardList: safeJsonParse(d.card_list, {}),
      syncDate: d.sync_date
    }))
  };
}

async function getStats(username) {
  const profile = await getQuery(
    `SELECT id, stats FROM untapped_profiles WHERE username = ?`,
    [username]
  );
  
  if (!profile) {
    return { error: 'Profile not found' };
  }
  
  // Aggregate match stats
  const matchStats = await getQuery(
    `SELECT 
      COUNT(*) as total_matches,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) as draws
    FROM untapped_matches
    WHERE profile_id = ?`,
    [profile.id]
  );
  
  // Deck performance
  const deckStats = await allQuery(
    `SELECT 
      deck_name,
      win_rate,
      matches_played
    FROM untapped_decks
    WHERE profile_id = ?
    ORDER BY matches_played DESC`,
    [profile.id]
  );
  
  // Format performance
  const formatStats = await allQuery(
    `SELECT 
      format,
      COUNT(*) as matches,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins
    FROM untapped_matches
    WHERE profile_id = ?
    GROUP BY format`,
    [profile.id]
  );
  
  const totalPlayed = matchStats.total_matches || 1;
  
  return {
    profile: safeJsonParse(profile.stats, {}),
    overall: {
      totalMatches: matchStats.total_matches || 0,
      wins: matchStats.wins || 0,
      losses: matchStats.losses || 0,
      draws: matchStats.draws || 0,
      winRate: totalPlayed > 0 
        ? Math.round((matchStats.wins / totalPlayed) * 100) 
        : 0
    },
    decks: deckStats.map(d => ({
      name: d.deck_name,
      winRate: d.win_rate,
      matchesPlayed: d.matches_played
    })),
    byFormat: formatStats.map(f => ({
      format: f.format,
      matches: f.matches,
      wins: f.wins,
      winRate: Math.round((f.wins / f.matches) * 100)
    }))
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
  syncProfile,
  getProfile,
  getMatches,
  getDecks,
  getStats
};
