# MTG Deck Builder Backend

API for Magic: The Gathering Arena deck building and analysis.

## Features

- **Card Database**: 3981 Standard-legal cards synced from Scryfall
- **Deck Analysis**: Mana curves, synergy detection, suggestions
- **Untapped.gg Integration**: Scrape profile data, matchups, win rates
- **Theory Crafting**: Card search and recommendation engine

## API Endpoints

```
GET  /cards/search?q=lightning     # Search cards
GET  /cards/:name                   # Get card by name
POST /decks                         # Create deck
GET  /decks/:id/analyze             # Analyze deck
POST /untapped/sync                 # Sync Untapped profile
```

## Quick Start

```bash
npm install
npm run sync:cards    # Download Standard cards
npm start             # API on localhost:3000
```

## Tech Stack

- Node.js + Express
- SQLite
- Playwright (web scraping)
- Scryfall API
