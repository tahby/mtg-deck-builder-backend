const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const deckService = require('../services/deckService');
const deckAnalysisService = require('../services/deckAnalysisService');

// GET /decks - List all decks
router.get('/', async (req, res, next) => {
  try {
    const { format, limit = 50, offset = 0 } = req.query;
    const decks = await deckService.listDecks({
      format,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    res.json(decks);
  } catch (error) {
    next(error);
  }
});

// POST /decks - Create new deck
router.post('/', async (req, res, next) => {
  try {
    const { name, format = 'standard', cards, sideboard, description, tags } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Deck name is required' });
    }
    
    const deckId = uuidv4();
    const deck = await deckService.createDeck({
      id: deckId,
      name,
      format,
      cards: cards || [],
      sideboard: sideboard || [],
      description,
      tags
    });
    
    res.status(201).json(deck);
  } catch (error) {
    next(error);
  }
});

// GET /decks/:id - Get deck by ID
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const deck = await deckService.getDeckById(id);
    
    if (!deck) {
      return res.status(404).json({ error: 'Deck not found' });
    }
    
    res.json(deck);
  } catch (error) {
    next(error);
  }
});

// PUT /decks/:id - Update deck
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, format, cards, sideboard, description, tags } = req.body;
    
    const existingDeck = await deckService.getDeckById(id);
    if (!existingDeck) {
      return res.status(404).json({ error: 'Deck not found' });
    }
    
    const updatedDeck = await deckService.updateDeck(id, {
      name,
      format,
      cards,
      sideboard,
      description,
      tags
    });
    
    res.json(updatedDeck);
  } catch (error) {
    next(error);
  }
});

// DELETE /decks/:id - Delete deck
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const existingDeck = await deckService.getDeckById(id);
    if (!existingDeck) {
      return res.status(404).json({ error: 'Deck not found' });
    }
    
    await deckService.deleteDeck(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// GET /decks/:id/analyze - Analyze deck
router.get('/:id/analyze', async (req, res, next) => {
  try {
    const { id } = req.params;
    const deck = await deckService.getDeckById(id);
    
    if (!deck) {
      return res.status(404).json({ error: 'Deck not found' });
    }
    
    const analysis = await deckAnalysisService.analyzeDeck(deck);
    res.json(analysis);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
