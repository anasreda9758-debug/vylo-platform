# VYLO

VYLO is a medical learning platform that brings structured curriculum,
lecture-linked PDFs, summaries, mind maps, quizzes, spaced-repetition
flashcards, clinical cases, and practical/OSPE study tools into one experience.

Repository: [anasreda9758-debug/vylo-platform](https://github.com/anasreda9758-debug/vylo-platform)

## Local development

Requirements:

- Node.js 24
- npm
- The existing local PostgreSQL development data directory

Start the local database and application:

```bash
npm run db:dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Stop the local database when finished:

```bash
npm run db:stop
```

## Validation

```bash
npm run typecheck
npm test
npm run lint
```

## Data safety

Do not reset, reseed, or bulk-import curriculum data during normal development.
Original PDFs and reviewed PDF mappings are preserved as source evidence. Read
`CURRENT_STATE.md` before continuing curriculum, Practical, or OSPE work.
