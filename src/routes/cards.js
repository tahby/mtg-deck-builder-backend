const express = require('express');
const router = express.Router();
const cardService = require('../services/cardService');

// GET /cards/search?q=...
router.get('/search', async (req, res, next) => {
  try {
    const {
      q,
      colors,
      type,
      cmc,
      cmc_min,
      cmc_max,
      rarity,
      set,
      legal_in = 'standard',
      limit = 50,
      offset = 0
    } = req.query;
    
    const searchParams = {
      query: q,
      colors: colors ? colors.split(',') : undefined,
      type,
      cmc: cmc ? parseFloat(cmc) : undefined,
      cmcMin: cmc_min ? parseFloat(cmc_min) : undefined,
      cmcMax: cmc_max ? parseFloat(cmc_max) : undefined,
      rarity,
      set,
      legalIn: legal_in,
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0
    };
    
    const results = await cardService.searchCards(searchParams);
    
    res.json({
      query: q,
      total: results.total,
      offset: searchParams.offset,
      limit: searchParams.limit,
      cards: results.cards
    });
  } catch (error) {
    next(error);
  }
});

// GET /cards/:name
router.get('/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const card = await cardService.getCardByName(decodeURIComponent(name));
    
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    res.json(card);
  } catch (error) {
    next(error);
  }
});

// GET /cards (list with filters)
router.get('/', async (req, res, next) => {
  try {
    const {
      colors,
      type,
      cmc_min,
      cmc_max,
      rarity,
      set,
      legal_in = 'standard',
      limit = 50,
      offset = 0
    } = req.query;
    
    const filterParams = {
      colors: colors ? colors.split(',') : undefined,
      type,
      cmcMin: cmc_min ? parseFloat(cmc_min) : undefined,
      cmcMax: cmc_max ? parseFloat(cmc_max) : undefined,
      rarity,
      set,
      legalIn: legal_in,
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0
    };
    
    const results = await cardService.listCards(filterParams);
    
    res.json({
      total: results.total,
      offset: filterParams.offset,
      limit: filterParams.limit,
      cards: results.cards
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
