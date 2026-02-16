const { chromium } = require('playwright');
const { runQuery, getQuery, allQuery } = require('./database');

const UNTAPPED_BASE_URL = 'https://mtga.untapped.gg';

class UntappedScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.context = null;
  }

  async init() {
    this.browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    });
    this.page = await this.context.newPage();
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.context = null;
    }
  }

  async dismissCookiePopup() {
    try {
      // Try to click "Do not consent" or "Consent" to dismiss
      const buttons = await this.page.$$('button');
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.textContent);
        if (text && (text.includes('Do not consent') || text.includes('Consent'))) {
          await btn.click();
          await this.page.waitForTimeout(1500);
          return;
        }
      }
    } catch (e) {
      // Popup might not exist
    }
  }

  async syncProfile(username, options = {}) {
    const { syncMatches = true, syncDecks = true } = options;
    
    try {
      if (!this.browser) await this.init();
      
      console.log(`Syncing Untapped profile: ${username}`);
      
      // Navigate to profile with full URL
      const profileUrl = `${UNTAPPED_BASE_URL}/profile/${username}`;
      await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.page.waitForTimeout(3000);
      
      // Dismiss cookie popup
      await this.dismissCookiePopup();
      
      // Check for 404
      const pageContent = await this.page.content();
      if (pageContent.includes('404') && pageContent.includes('Totally Lost')) {
        throw new Error(`Profile not found: ${username}`);
      }
      
      // Get or create profile
      let profile = await getQuery(
        'SELECT * FROM untapped_profiles WHERE username = ?',
        [username]
      );
      
      if (!profile) {
        const result = await runQuery(
          'INSERT INTO untapped_profiles (username, last_synced) VALUES (?, ?)',
          [username, new Date().toISOString()]
        );
        profile = { id: result.id, username };
      } else {
        await runQuery(
          'UPDATE untapped_profiles SET last_synced = ? WHERE id = ?',
          [new Date().toISOString(), profile.id]
        );
      }
      
      const results = {
        profileId: profile.id,
        username,
        matchesSynced: 0,
        decksSynced: 0
      };
      
      // Extract all data from the page
      const pageData = await this.extractPageData();
      
      if (syncDecks && pageData.decks.length > 0) {
        results.decksSynced = await this.saveDecks(profile.id, pageData.decks);
        console.log(`Synced ${results.decksSynced} decks`);
      }
      
      if (syncMatches && pageData.matchups.length > 0) {
        results.matchesSynced = await this.saveMatchups(profile.id, pageData.matchups);
        console.log(`Synced ${results.matchesSynced} matchups`);
      }
      
      return results;
    } catch (error) {
      console.error('Error syncing profile:', error);
      throw error;
    }
  }

  async extractPageData() {
    return await this.page.evaluate(() => {
      const data = {
        decks: [],
        matchups: []
      };
      
      // Extract deck data from deck cards
      const deckCards = document.querySelectorAll('.deckbox, [class*="deck-card"], [data-testid*="deck"]');
      
      deckCards.forEach(card => {
        const text = card.textContent || '';
        
        // Deck name - look for specific class or span
        const nameEl = card.querySelector('[class*="sc-eNSrOW"], [class*="deck-name"], h3');
        let name = nameEl?.textContent?.trim() || '';
        
        // Fallback: extract from text
        if (!name || name === 'Copy Deck') {
          const nameMatch = text.match(/([A-Za-z0-9]+Claw[A-Za-z0-9]*|[A-Za-z]+(?:-[A-Za-z]+)+(?:Aggro)?)/);
          name = nameMatch ? nameMatch[1].trim() : 'Unknown Deck';
        }
        
        // Win rate
        const winRateMatch = text.match(/Winrate\s*(\d+)%/i) || 
                            text.match(/(\d+)%/);
        const winRate = winRateMatch ? parseInt(winRateMatch[1]) : null;
        
        // Matches record (e.g., "6 - 4")
        const matchesMatch = text.match(/Matches\s*(\d+)\s*[-–]\s*(\d+)/i) ||
                            text.match(/(\d+)\s*[-–]\s*(\d+)/);
        let wins = 0, losses = 0;
        if (matchesMatch) {
          wins = parseInt(matchesMatch[1]);
          losses = parseInt(matchesMatch[2]);
        }
        
        // Colors from mana symbols
        const colorIcons = card.querySelectorAll('img[alt*="mana"], [class*="mana"]');
        const colors = [];
        colorIcons.forEach(img => {
          const alt = img.alt || '';
          if (alt.includes('W')) colors.push('W');
          if (alt.includes('U')) colors.push('U');
          if (alt.includes('B')) colors.push('B');
          if (alt.includes('R')) colors.push('R');
          if (alt.includes('G')) colors.push('G');
        });
        
        // Last played
        const lastPlayedMatch = text.match(/Last Played:\s*(.+?)(?:\n|$)/i) ||
                               text.match(/(\d+\s+(?:minute|hour|day)s?\s+ago)/i);
        const lastPlayed = lastPlayedMatch ? lastPlayedMatch[1].trim() : null;
        
        if (name && name !== 'Unknown Deck') {
          data.decks.push({
            name,
            winRate,
            wins,
            losses,
            matches: wins + losses,
            colors: [...new Set(colors)],
            lastPlayed
          });
        }
      });
      
      // Extract matchup data
      const matchupRows = document.querySelectorAll('table tr, [class*="matchup"]');
      
      matchupRows.forEach(row => {
        const cells = row.querySelectorAll('td, [class*="cell"]');
        if (cells.length >= 3) {
          const text = row.textContent || '';
          
          // Look for "vs. [colors]" pattern
          const vsMatch = text.match(/vs\.?\s*([WUBRG]+)/i);
          const winRateMatch = text.match(/(\d+)%/);
          const recordMatch = text.match(/(\d+)\s*-\s*(\d+)/);
          
          if (vsMatch && winRateMatch) {
            data.matchups.push({
              opponentColors: vsMatch[1],
              winRate: parseInt(winRateMatch[1]),
              wins: recordMatch ? parseInt(recordMatch[1]) : 0,
              losses: recordMatch ? parseInt(recordMatch[2]) : 0
            });
          }
        }
      });
      
      return data;
    });
  }

  async saveDecks(profileId, decks) {
    let syncedCount = 0;
    
    for (const deck of decks) {
      try {
        const existing = await getQuery(
          'SELECT id FROM untapped_decks WHERE profile_id = ? AND deck_name = ?',
          [profileId, deck.name]
        );
        
        if (existing) {
          await runQuery(
            `UPDATE untapped_decks 
             SET win_rate = ?, matches_played = ?, colors = ?, last_played = ?, sync_date = datetime('now')
             WHERE id = ?`,
            [deck.winRate, deck.matches, JSON.stringify(deck.colors), deck.lastPlayed, existing.id]
          );
        } else {
          await runQuery(
            `INSERT INTO untapped_decks 
             (profile_id, deck_name, win_rate, matches_played, colors, last_played, sync_date)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
            [profileId, deck.name, deck.winRate, deck.matches, JSON.stringify(deck.colors), deck.lastPlayed]
          );
          syncedCount++;
        }
      } catch (err) {
        console.error('Error saving deck:', err.message);
      }
    }
    
    return syncedCount;
  }

  async saveMatchups(profileId, matchups) {
    // Store matchups as JSON in profile stats for now
    try {
      await runQuery(
        `UPDATE untapped_profiles SET stats = ? WHERE id = ?`,
        [JSON.stringify({ matchups }), profileId]
      );
      return matchups.length;
    } catch (err) {
      console.error('Error saving matchups:', err.message);
      return 0;
    }
  }

  async getDeckList(deckUrl) {
    try {
      if (!this.browser) await this.init();
      
      await this.page.goto(deckUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.page.waitForTimeout(3000);
      
      await this.dismissCookiePopup();
      
      const decklist = await this.page.evaluate(() => {
        const cards = [];
        const cardElements = document.querySelectorAll('[data-testid*="card"], [class*="decklist"] [class*="card"]');
        
        cardElements.forEach(el => {
          const text = el.textContent || '';
          const qtyMatch = text.match(/^(\d+)\s*/);
          
          const nameEl = el.querySelector('[class*="name"], h4, h3');
          const name = nameEl ? nameEl.textContent.trim() : text.replace(/^\d+\s*/, '').trim();
          
          if (qtyMatch && name) {
            cards.push({
              quantity: parseInt(qtyMatch[1]),
              name: name
            });
          }
        });
        
        return cards;
      });
      
      return decklist;
    } catch (error) {
      console.error('Error getting deck list:', error);
      throw error;
    }
  }
}

module.exports = UntappedScraper;
