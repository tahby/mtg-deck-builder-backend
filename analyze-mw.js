const { getCardsByNames } = require('./src/services/cardService');

async function deepDive() {
  const cards = await getCardsByNames([
    'Origin of Spider-Man',
    'Skyward Spider', 
    'Sheltered by Ghosts',
    'Optimistic Scavenger',
    'Veteran Survivor',
    'Ethereal Armor',
    "Shardmage's Rescue",
    'Spellbook Vendor',
    'Seam Rip',
    'Feather of Flight'
  ]);
  
  console.log('=== DEEP DIVE: Mono-White Aggro ===\n');
  
  // Categorize
  const oneDrops = cards.filter(c => c.cmc === 1 && !c.type_line.includes('Land'));
  const twoDrops = cards.filter(c => c.cmc === 2);
  const threeDrops = cards.filter(c => c.cmc === 3);
  
  console.log('1-Drops (8 cards):');
  oneDrops.forEach(c => console.log('  ' + c.name + ' - ' + (c.oracle_text?.substring(0, 60) + '...' || '')));
  
  console.log('\n2-Drops (4 cards):');
  twoDrops.forEach(c => console.log('  ' + c.name + ' - ' + (c.oracle_text?.substring(0, 60) + '...' || '')));
  
  console.log('\n3-Drops (8 cards - PROBLEM):');
  threeDrops.forEach(c => {
    console.log('  ' + c.name + ' (' + c.mana_cost + ') - ' + (c.oracle_text?.substring(0, 80) || ''));
  });
  
  // Check for interaction
  const removal = cards.filter(c => 
    c.oracle_text?.includes('destroy') || 
    c.oracle_text?.includes('exile') ||
    c.oracle_text?.includes('damage')
  );
  
  console.log('\nRemoval/Interaction:');
  removal.forEach(c => console.log('  ' + c.name + ' - ' + (c.oracle_text?.substring(0, 80) || '')));
  
  // Card draw?
  const cardDraw = cards.filter(c => 
    c.oracle_text?.includes('draw a card') ||
    c.oracle_text?.includes('investigate')
  );
  
  console.log('\nCard Draw:');
  if (cardDraw.length === 0) {
    console.log('  NONE - This is a problem for grinding');
  } else {
    cardDraw.forEach(c => console.log('  ' + c.name));
  }
  
  console.log('\n=== VERDICT ===');
  console.log('20 lands + 8 three-drops = you will miss your third land drop.');
  console.log('No card draw = you lose to any deck with removal.');
  console.log('Seam Rip only hits MV 2 or less = big creatures stonewall you.');
}
deepDive().catch(console.error);
