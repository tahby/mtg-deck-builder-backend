const UntappedScraper = require('./src/utils/untappedScraper');

async function getDeckMatchups() {
  const scraper = new UntappedScraper();
  try {
    await scraper.init();
    
    const url = 'https://mtga.untapped.gg/profile/114f5e3d-ddc0-4ca6-a6a3-46b10aba59cd/YQV2AQFRSNH5HOJ6UC2CAFH4DI/deck/fbd6e587-7603-4188-94eb-1b5898f11f55?gameType=constructed&constructedType=ranked';
    await scraper.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await scraper.page.waitForTimeout(3000);
    
    await scraper.dismissCookiePopup();
    await scraper.page.waitForTimeout(1000);
    
    // Scroll down to matchups
    await scraper.page.evaluate(() => window.scrollTo(0, 800));
    await scraper.page.waitForTimeout(2000);
    
    await scraper.page.screenshot({ path: '/tmp/deck-matchups2.png', fullPage: false });
    
    // Extract matchup data from the table
    const data = await scraper.page.evaluate(() => {
      const result = [];
      
      // Find all table rows in the matchups section
      const allRows = document.querySelectorAll('tr');
      
      allRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const matchup = cells[0]?.textContent?.trim();
          const winrate = cells[1]?.textContent?.trim();
          const matches = cells[2]?.textContent?.trim();
          
          if (matchup && winrate && matches) {
            result.push({ matchup, winrate, matches });
          }
        }
      });
      
      return result;
    });
    
    console.log('Matchups:', JSON.stringify(data, null, 2));
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await scraper.close();
  }
}
getDeckMatchups();
