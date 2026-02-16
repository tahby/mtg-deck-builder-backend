const { chromium } = require('playwright');

const BASE_URL = 'https://mtga.untapped.gg';

async function scrapeProfile(username, options = {}) {
  const { syncMatches = true, syncDecks = true, headless = true } = options;
  
  const browser = await chromium.launch({ headless });
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0'
    });
    
    const page = await context.newPage();
    
    console.log(`Navigating to ${BASE_URL}/profile/${username}`);
    
    // Navigate to profile page
    await page.goto(`${BASE_URL}/profile/${username}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // Check if profile exists
    const notFound = await page.locator('text=Profile not found').first().isVisible().catch(() => false);
    if (notFound) {
      throw new Error(`Profile "${username}" not found on Untapped.gg`);
    }
    
    // Accept cookies if present
    const acceptCookies = await page.locator('button:has-text("Accept"), button:has-text("I Accept")').first();
    if (await acceptCookies.isVisible().catch(() => false)) {
      await acceptCookies.click();
      await page.waitForTimeout(1000);
    }
    
    // Extract profile data
    const profileData = await extractProfileData(page);
    
    // Extract stats
    const stats = await extractStats(page);
    
    // Extract match history
    let matches = [];
    if (syncMatches) {
      matches = await extractMatchHistory(page);
    }
    
    // Extract decks
    let decks = [];
    if (syncDecks) {
      decks = await extractDecks(page);
    }
    
    return {
      profile: profileData,
      stats,
      matches,
      decks
    };
    
  } catch (error) {
    console.error('Scraping error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

async function extractProfileData(page) {
  try {
    const displayName = await page.locator('h1, .profile-name').first().textContent({ timeout: 5000 })
      .catch(() => null);
    
    const avatarUrl = await page.locator('img[alt*="avatar"], .avatar img').first()
      .getAttribute('src')
      .catch(() => null);
    
    return {
      displayName: displayName?.trim() || 'Unknown',
      avatarUrl: avatarUrl || null
    };
  } catch (error) {
    console.warn('Could not extract profile data:', error.message);
    return { displayName: 'Unknown', avatarUrl: null };
  }
}

async function extractStats(page) {
  try {
    // Look for win rate stats
    const statsSection = await page.locator('.stats, .win-rate, [class*="stat"]').all();
    
    const stats = {};
    
    for (const section of statsSection.slice(0, 5)) {
      const text = await section.textContent().catch(() => '');
      
      // Extract win rate
      const winRateMatch = text.match(/(\d+)%/);
      if (winRateMatch && !stats.overallWinRate) {
        stats.overallWinRate = parseInt(winRateMatch[1]);
      }
      
      // Extract total matches
      const matchesMatch = text.match(/(\d+)\s*(?:matches|games)/i);
      if (matchesMatch && !stats.totalMatches) {
        stats.totalMatches = parseInt(matchesMatch[1]);
      }
    }
    
    return stats;
  } catch (error) {
    console.warn('Could not extract stats:', error.message);
    return {};
  }
}

async function extractMatchHistory(page) {
  const matches = [];
  
  try {
    // Navigate to matches section if needed
    const matchesTab = await page.locator('text=Matches, text=History, [data-tab="matches"]').first();
    if (await matchesTab.isVisible().catch(() => false)) {
      await matchesTab.click();
      await page.waitForTimeout(2000);
    }
    
    // Scroll to load more matches
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1000);
    }
    
    // Try to find match rows
    const matchSelectors = [
      '[class*="match"]',
      '.match-row',
      '[class*="game"]',
      'tr:has-text("win"), tr:has-text("loss")',
      '[class*="result"]'
    ];
    
    let matchElements = [];
    for (const selector of matchSelectors) {
      matchElements = await page.locator(selector).all();
      if (matchElements.length > 0) break;
    }
    
    for (const matchEl of matchElements.slice(0, 50)) {
      try {
        const text = await matchEl.textContent();
        
        // Extract result
        let result = 'unknown';
        if (text.toLowerCase().includes('victory') || text.toLowerCase().includes('win')) {
          result = 'win';
        } else if (text.toLowerCase().includes('defeat') || text.toLowerCase().includes('loss')) {
          result = 'loss';
        } else if (text.toLowerCase().includes('draw')) {
          result = 'draw';
        }
        
        // Extract deck used
        const deckMatch = text.match(/(?:deck|using)[\s:]+([^\n]+)/i);
        const deckUsed = deckMatch ? deckMatch[1].trim() : 'Unknown';
        
        // Extract opponent
        const opponentMatch = text.match(/(?:vs\.?|versus|against|opponent)[\s:]+([^\n]+)/i);
        const opponent = opponentMatch ? opponentMatch[1].trim() : 'Unknown';
        
        // Extract format
        const formatMatch = text.match(/(standard|historic|alchemy|explorer|pioneer|modern)/i);
        const format = formatMatch ? formatMatch[1].toLowerCase() : 'unknown';
        
        // Extract date
        const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
        const playedAt = dateMatch ? dateMatch[1] : new Date().toISOString();
        
        matches.push({
          id: `match_${Date.now()}_${matches.length}`,
          result,
          deckUsed,
          opponentDeck: 'Unknown',
          opponent,
          format,
          playedAt,
          duration: null,
          metadata: { rawText: text.slice(0, 500) }
        });
      } catch (e) {
        // Skip problematic matches
      }
    }
    
  } catch (error) {
    console.warn('Could not extract match history:', error.message);
  }
  
  return matches;
}

async function extractDecks(page) {
  const decks = [];
  
  try {
    // Navigate to decks section
    const decksTab = await page.locator('text=Decks, [data-tab="decks"]').first();
    if (await decksTab.isVisible().catch(() => false)) {
      await decksTab.click();
      await page.waitForTimeout(2000);
    }
    
    // Look for deck elements
    const deckSelectors = [
      '[class*="deck-card"]',
      '[class*="deck-item"]',
      '.deck',
      '[class*="deck-list"] > div'
    ];
    
    let deckElements = [];
    for (const selector of deckSelectors) {
      deckElements = await page.locator(selector).all();
      if (deckElements.length > 0) break;
    }
    
    for (const deckEl of deckElements.slice(0, 20)) {
      try {
        const text = await deckEl.textContent();
        
        // Extract deck name
        const nameMatch = text.match(/^([^\n]+)/);
        const name = nameMatch ? nameMatch[1].trim() : 'Unknown Deck';
        
        // Extract win rate
        const winRateMatch = text.match(/(\d+)%/);
        const winRate = winRateMatch ? parseInt(winRateMatch[1]) : null;
        
        // Extract match count
        const matchesMatch = text.match(/(\d+)\s*(?:matches|games)/i);
        const matchesPlayed = matchesMatch ? parseInt(matchesMatch[1]) : 0;
        
        // Extract colors (look for mana symbols)
        const colors = [];
        if (text.includes('W') || text.toLowerCase().includes('white')) colors.push('W');
        if (text.includes('U') || text.toLowerCase().includes('blue')) colors.push('U');
        if (text.includes('B') || text.toLowerCase().includes('black')) colors.push('B');
        if (text.includes('R') || text.toLowerCase().includes('red')) colors.push('R');
        if (text.includes('G') || text.toLowerCase().includes('green')) colors.push('G');
        
        // Extract format
        const formatMatch = text.match(/(standard|historic|alchemy|explorer|pioneer)/i);
        const format = formatMatch ? formatMatch[1].toLowerCase() : 'standard';
        
        decks.push({
          name,
          format,
          colors,
          winRate,
          matchesPlayed,
          lastPlayed: new Date().toISOString(),
          cardList: {}
        });
      } catch (e) {
        // Skip problematic decks
      }
    }
    
  } catch (error) {
    console.warn('Could not extract decks:', error.message);
  }
  
  return decks;
}

module.exports = {
  scrapeProfile
};
