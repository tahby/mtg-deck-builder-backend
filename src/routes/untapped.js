const express = require('express');
const router = express.Router();
const UntappedScraper = require('../utils/untappedScraper');
const { allQuery, getQuery } = require('../utils/database');

// POST /untapped/sync - Sync profile from Untapped.gg
router.post('/sync', async (req, res, next) => {
  const scraper = new UntappedScraper();
  
  try {
    const { username, syncMatches = true, syncDecks = true } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    const results = await scraper.syncProfile(username, { syncMatches, syncDecks });
    
    res.json({
      success: true,
      ...results
    });
  } catch (error) {
    next(error);
  } finally {
    await scraper.close();
  }
});

// GET /untapped/profiles/:username - Get profile data
router.get('/profiles/:username', async (req, res, next) => {
  try {
    const { username } = req.params;
    
    const profile = await getQuery(
      `SELECT p.*, 
              COUNT(DISTINCT m.id) as total_matches,
              COUNT(DISTINCT d.id) as total_decks
       FROM untapped_profiles p
       LEFT JOIN untapped_matches m ON p.id = m.profile_id
       LEFT JOIN untapped_decks d ON p.id = d.profile_id
       WHERE p.username = ?
       GROUP BY p.id`,
      [username]
    );
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

// GET /untapped/profiles/:username/matches - Get match history
router.get('/profiles/:username/matches', async (req, res, next) => {
  try {
    const { username } = req.params;
    const { limit = 50, offset = 0, deck } = req.query;
    
    const profile = await getQuery(
      'SELECT id FROM untapped_profiles WHERE username = ?',
      [username]
    );
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    let sql = `
      SELECT * FROM untapped_matches
      WHERE profile_id = ?
    `;
    const params = [profile.id];
    
    if (deck) {
      sql += ` AND deck_used = ?`;
      params.push(deck);
    }
    
    sql += ` ORDER BY played_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    const matches = await allQuery(sql, params);
    
    // Calculate win rates
    const stats = await getQuery(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
       FROM untapped_matches
       WHERE profile_id = ?`,
      [profile.id]
    );
    
    res.json({
      matches,
      stats: {
        ...stats,
        winRate: stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /untapped/profiles/:username/decks - Get deck performance
router.get('/profiles/:username/decks', async (req, res, next) => {
  try {
    const { username } = req.params;
    
    const profile = await getQuery(
      'SELECT id FROM untapped_profiles WHERE username = ?',
      [username]
    );
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    const decks = await allQuery(
      `SELECT * FROM untapped_decks
       WHERE profile_id = ?
       ORDER BY matches_played DESC`,
      [profile.id]
    );
    
    res.json(decks.map(d => ({
      ...d,
      colors: JSON.parse(d.colors || '[]')
    })));
  } catch (error) {
    next(error);
  }
});

// GET /untapped/profiles/:username/stats - Get detailed stats
router.get('/profiles/:username/stats', async (req, res, next) => {
  try {
    const { username } = req.params;
    
    const profile = await getQuery(
      'SELECT id FROM untapped_profiles WHERE username = ?',
      [username]
    );
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    // Overall stats
    const overall = await getQuery(
      `SELECT 
        COUNT(*) as total_matches,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
        AVG(CASE WHEN result = 'win' THEN 1 ELSE 0 END) * 100 as win_rate
       FROM untapped_matches
       WHERE profile_id = ?`,
      [profile.id]
    );
    
    // Stats by deck
    const deckStats = await allQuery(
      `SELECT 
        deck_used,
        COUNT(*) as matches,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        ROUND(AVG(CASE WHEN result = 'win' THEN 1 ELSE 0 END) * 100, 1) as win_rate
       FROM untapped_matches
       WHERE profile_id = ?
       GROUP BY deck_used
       ORDER BY matches DESC`,
      [profile.id]
    );
    
    // Recent trend (last 20 matches)
    const recentMatches = await allQuery(
      `SELECT result FROM untapped_matches
       WHERE profile_id = ?
       ORDER BY played_at DESC
       LIMIT 20`,
      [profile.id]
    );
    
    const recentWins = recentMatches.filter(m => m.result === 'win').length;
    
    res.json({
      overall: {
        ...overall,
        win_rate: overall.win_rate?.toFixed(1) || 0
      },
      deckStats,
      recentTrend: {
        matches: recentMatches.length,
        wins: recentWins,
        winRate: recentMatches.length > 0 ? ((recentWins / recentMatches.length) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
