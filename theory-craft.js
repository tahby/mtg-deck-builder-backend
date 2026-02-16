const { allQuery } = require('./src/utils/database');

async function theoryCraft() {
  console.log('=== THEORY CRAFTING: Mono-White Aggro ===\n');
  
  // 1. Find ALL 1-drop white creatures in Standard
  console.log('1. ONE-DROP OPTIONS (replace Veteran Survivor):');
  const oneDrops = await allQuery(`
    SELECT name, mana_cost, power, toughness, oracle_text
    FROM cards
    WHERE cmc = 1 
      AND colors LIKE '%W%'
      AND type_line LIKE '%Creature%'
      AND legalities LIKE '%standard%legal%'
    ORDER BY name
  `);
  
  oneDrops.forEach(c => {
    const stats = c.power ? `${c.power}/${c.toughness}` : '';
    const text = (c.oracle_text || '').substring(0, 60);
    console.log(`  ${c.name} ${stats} ${c.mana_cost}`);
    if (text) console.log(`    ${text}...`);
  });
  
  // 2. Card draw/filtering in white
  console.log('\n2. CARD ADVANTAGE IN WHITE (replace something):');
  const cardDraw = await allQuery(`
    SELECT name, mana_cost, oracle_text
    FROM cards
    WHERE colors LIKE '%W%'
      AND legalities LIKE '%standard%legal%'
      AND (
        oracle_text LIKE '%draw a card%' OR
        oracle_text LIKE '%scry%' OR
        oracle_text LIKE '%investigate%'
      )
      AND cmc <= 3
      AND type_line NOT LIKE '%Land%'
    ORDER BY cmc, name
  `);
  
  cardDraw.slice(0, 15).forEach(c => {
    console.log(`  ${c.name} ${c.mana_cost}`);
  });
  
  // 3. Two-drop creatures
  console.log('\n3. TWO-DROP CREATURES (add to curve):');
  const twoDrops = await allQuery(`
    SELECT name, mana_cost, power, toughness, oracle_text
    FROM cards
    WHERE cmc = 2
      AND colors LIKE '%W%'
      AND type_line LIKE '%Creature%'
      AND legalities LIKE '%standard%legal%'
    ORDER BY name
    LIMIT 15
  `);
  
  twoDrops.forEach(c => {
    const stats = c.power ? `${c.power}/${c.toughness}` : '';
    console.log(`  ${c.name} ${c.mana_cost} ${stats}`);
  });
  
  // 4. All cheap white enchantments (Eerie triggers)
  console.log('\n4. CHEAP ENCHANTMENTS (Eerie synergy):');
  const enchantments = await allQuery(`
    SELECT name, mana_cost, type_line
    FROM cards
    WHERE cmc <= 2
      AND colors LIKE '%W%'
      AND legalities LIKE '%standard%legal%'
      AND type_line LIKE '%Enchantment%'
    ORDER BY cmc, name
    LIMIT 20
  `);
  
  enchantments.forEach(c => {
    console.log(`  ${c.name} ${c.mana_cost}`);
  });
}

theoryCraft().catch(console.error);
