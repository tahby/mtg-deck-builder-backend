const cardService = require('./cardService');
const { allQuery } = require('../utils/database');

async function analyzeDeck(deck) {
  const allCards = [...deck.cards, ...deck.sideboard];
  const cardNames = allCards.map(c => c.name);
  const cardData = await cardService.getCardsByNames(cardNames);
  
  // Enrich deck cards with full data
  const enrichedCards = deck.cards.map(deckCard => {
    const fullCard = cardData.find(c => 
      c.name.toLowerCase() === deckCard.name.toLowerCase()
    );
    return {
      ...deckCard,
      ...(fullCard || {}),
      quantity: deckCard.quantity
    };
  }).filter(c => c.oracle_text !== undefined); // Only include found cards
  
  const stats = calculateStats(enrichedCards);
  const manaCurve = calculateManaCurve(enrichedCards);
  const colorDistribution = calculateColorDistribution(enrichedCards);
  const synergies = await detectSynergies(enrichedCards);
  const suggestions = generateSuggestions(enrichedCards, stats, manaCurve);
  const metaPredictions = generateMetaPredictions(enrichedCards, stats);
  
  return {
    deckId: deck.id,
    name: deck.name,
    format: deck.format,
    stats,
    manaCurve,
    colorDistribution,
    synergies,
    suggestions,
    metaPredictions
  };
}

function calculateStats(cards) {
  let lands = 0;
  let creatures = 0;
  let artifacts = 0;
  let enchantments = 0;
  let instants = 0;
  let sorceries = 0;
  let planeswalkers = 0;
  let battles = 0;
  let totalCmc = 0;
  let cardCount = 0;
  const colorIdentity = new Set();
  
  for (const card of cards) {
    const qty = card.quantity || 1;
    cardCount += qty;
    
    const typeLine = (card.type_line || '').toLowerCase();
    
    // Card types
    if (typeLine.includes('land')) lands += qty;
    if (typeLine.includes('creature')) creatures += qty;
    if (typeLine.includes('artifact')) artifacts += qty;
    if (typeLine.includes('enchantment')) enchantments += qty;
    if (typeLine.includes('instant')) instants += qty;
    if (typeLine.includes('sorcery')) sorceries += qty;
    if (typeLine.includes('planeswalker')) planeswalkers += qty;
    if (typeLine.includes('battle')) battles += qty;
    
    // CMC (exclude lands)
    if (!typeLine.includes('land') && card.cmc !== undefined) {
      totalCmc += card.cmc * qty;
    }
    
    // Color identity
    if (card.color_identity) {
      card.color_identity.forEach(c => colorIdentity.add(c));
    }
  }
  
  const nonLandCards = cardCount - lands;
  const averageCmc = nonLandCards > 0 ? totalCmc / nonLandCards : 0;
  
  return {
    totalCards: cardCount,
    lands,
    creatures,
    artifacts,
    enchantments,
    instants,
    sorceries,
    planeswalkers,
    battles,
    nonLandCards,
    averageCmc: Math.round(averageCmc * 10) / 10,
    colorIdentity: [...colorIdentity].sort()
  };
}

function calculateManaCurve(cards) {
  const curve = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6+': 0 };
  
  for (const card of cards) {
    const typeLine = (card.type_line || '').toLowerCase();
    if (typeLine.includes('land')) continue;
    
    const cmc = card.cmc || 0;
    const qty = card.quantity || 1;
    
    if (cmc === 0) curve['0'] += qty;
    else if (cmc === 1) curve['1'] += qty;
    else if (cmc === 2) curve['2'] += qty;
    else if (cmc === 3) curve['3'] += qty;
    else if (cmc === 4) curve['4'] += qty;
    else if (cmc === 5) curve['5'] += qty;
    else curve['6+'] += qty;
  }
  
  return curve;
}

function calculateColorDistribution(cards) {
  const distribution = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  
  for (const card of cards) {
    const qty = card.quantity || 1;
    const colors = card.colors || [];
    const typeLine = (card.type_line || '').toLowerCase();
    
    if (colors.length === 0 && !typeLine.includes('land')) {
      // Colorless non-land
      distribution.C += qty;
    } else {
      colors.forEach(color => {
        if (distribution[color] !== undefined) {
          distribution[color] += qty;
        }
      });
    }
  }
  
  return distribution;
}

async function detectSynergies(cards) {
  const patterns = await allQuery('SELECT * FROM synergy_patterns');
  const detectedSynergies = [];
  
  for (const pattern of patterns) {
    const matchingCards = [];
    let supportCount = 0;
    
    const keywords = safeJsonParse(pattern.keywords, []);
    const oraclePatterns = safeJsonParse(pattern.oracle_patterns, []);
    const typePatterns = safeJsonParse(pattern.type_patterns, []);
    
    for (const card of cards) {
      let matches = false;
      
      // Check keywords
      if (keywords.length > 0 && card.keywords) {
        if (keywords.some(k => card.keywords.includes(k))) {
          matches = true;
        }
      }
      
      // Check oracle text patterns
      if (!matches && oraclePatterns.length > 0 && card.oracle_text) {
        const oracleText = card.oracle_text.toLowerCase();
        if (oraclePatterns.some(p => oracleText.includes(p.toLowerCase()))) {
          matches = true;
        }
      }
      
      // Check type line patterns
      if (!matches && typePatterns.length > 0 && card.type_line) {
        const typeLine = card.type_line.toLowerCase();
        if (typePatterns.some(p => typeLine.includes(p.toLowerCase()))) {
          matches = true;
        }
      }
      
      if (matches) {
        matchingCards.push(card.name);
        supportCount += card.quantity || 1;
      }
    }
    
    // Only report if we have meaningful synergy (at least 3 cards or 4+ copies)
    if (matchingCards.length >= 2 || supportCount >= 4) {
      detectedSynergies.push({
        type: pattern.pattern_type,
        name: pattern.name,
        description: pattern.description,
        cards: matchingCards,
        supportCount,
        weight: pattern.weight
      });
    }
  }
  
  // Sort by support count (descending)
  detectedSynergies.sort((a, b) => b.supportCount - a.supportCount);
  
  return detectedSynergies;
}

function generateSuggestions(cards, stats, manaCurve) {
  const suggestions = [];
  
  // Mana base suggestions
  const expectedLands = Math.round(stats.averageCmc * 8);
  if (stats.lands < expectedLands - 2) {
    suggestions.push({
      type: 'land',
      priority: 'high',
      message: `Consider adding ${expectedLands - stats.lands} more lands for average CMC of ${stats.averageCmc}`
    });
  } else if (stats.lands > expectedLands + 4) {
    suggestions.push({
      type: 'land',
      priority: 'medium',
      message: `Deck has ${stats.lands} lands which may be high for average CMC of ${stats.averageCmc}`
    });
  }
  
  // Curve suggestions
  const totalNonLand = stats.creatures + stats.artifacts + stats.enchantments + 
                       stats.instants + stats.sorceries + stats.planeswalkers;
  
  if (totalNonLand > 0) {
    const twoDrops = manaCurve['2'] || 0;
    const threeDrops = manaCurve['3'] || 0;
    const fourPlus = (manaCurve['4'] || 0) + (manaCurve['5'] || 0) + (manaCurve['6+'] || 0);
    
    if (twoDrops < 6 && stats.averageCmc > 2.5) {
      suggestions.push({
        type: 'curve',
        priority: 'high',
        message: 'Low count of 2-drops may hurt consistency. Consider more early plays.'
      });
    }
    
    if (fourPlus > 12) {
      suggestions.push({
        type: 'curve',
        priority: 'medium',
        message: 'High curve with many 4+ drops. Consider trimming for lower curve.'
      });
    }
  }
  
  // Creature count for aggro/midrange
  if (stats.creatures < 12 && stats.averageCmc < 3) {
    suggestions.push({
      type: 'composition',
      priority: 'medium',
      message: 'Low creature count for a lower-curve deck. Consider more threats.'
    });
  }
  
  // Card type balance
  if (stats.totalCards < 60) {
    suggestions.push({
      type: 'composition',
      priority: 'high',
      message: `Deck has ${stats.totalCards} cards. Standard requires minimum 60.`
    });
  }
  
  // Interaction check
  const interaction = stats.instants + stats.sorceries;
  if (interaction < 4 && stats.averageCmc > 2.5) {
    suggestions.push({
      type: 'interaction',
      priority: 'medium',
      message: 'Low interaction/removal. Consider adding answers to opponent threats.'
    });
  }
  
  return suggestions.sort((a, b) => {
    const priorities = { high: 3, medium: 2, low: 1 };
    return priorities[b.priority] - priorities[a.priority];
  });
}

function generateMetaPredictions(cards, stats) {
  // Simple heuristic-based predictions
  const predictions = {
    vsAggro: 'even',
    vsControl: 'even', 
    vsMidrange: 'even',
    vsCombo: 'even',
    overallTier: 'C'
  };
  
  const avgCmc = stats.averageCmc;
  const hasEarlyGame = (manaCurve) => (manaCurve['1'] || 0) + (manaCurve['2'] || 0) >= 12;
  const hasLateGame = stats.lands >= 24;
  const hasInteraction = stats.instants + stats.sorceries >= 6;
  
  const curve = calculateManaCurve(cards);
  
  // Aggro matchup
  if (avgCmc < 2.5 && stats.creatures >= 16) {
    // We're also aggro - mirror
    predictions.vsAggro = 'even';
    predictions.vsControl = hasEarlyGame(curve) ? 'favored' : 'even';
  } else if (avgCmc > 3.5 && hasInteraction) {
    // We're control
    predictions.vsAggro = hasEarlyGame(curve) ? 'favored' : 'even';
    predictions.vsControl = 'even';
  } else {
    // Midrange
    predictions.vsAggro = hasInteraction ? 'even' : 'unfavored';
    predictions.vsControl = 'even';
  }
  
  // Determine tier based on stats
  const hasGoodCurve = (curve['2'] || 0) >= 8 && (curve['3'] || 0) >= 6;
  const hasManaBase = stats.lands >= 23 && stats.lands <= 26;
  
  if (hasGoodCurve && hasManaBase && hasInteraction && stats.totalCards >= 60) {
    predictions.overallTier = 'A';
  } else if (hasManaBase && stats.totalCards >= 60) {
    predictions.overallTier = 'B';
  } else {
    predictions.overallTier = 'C';
  }
  
  return predictions;
}

function safeJsonParse(json, defaultValue) {
  try {
    return json ? JSON.parse(json) : defaultValue;
  } catch {
    return defaultValue;
  }
}

module.exports = {
  analyzeDeck
};
