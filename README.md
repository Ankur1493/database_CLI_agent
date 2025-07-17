# database-cli-agent

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.5. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

# Phases for development

## 1. Initial Setup

- [x] Break the assignment into parts
- [x] Setup the project

## 2. CLI Tool

- [x] Setup CLI with commander js
- [x] Print CLI logs: "Agent is thinking...", "Editing file...", etc.

## 3. File traversing and data retrieval

- [x] Confirm the path for project from the user
- [] Parse `app/page.tsx` - taking an assumption atm for spotify project - but later we might have multiple pages - so can add a question or something to verify which page
- [] Resolve and read all imported components
- [] Extract constants from components
- [] Detect duplicate dataset names (e.g. `recentlyPlayed`) and resolve conflicts

## 5. Drizzle init

- [] Check if there is a dirzzle config,schema and all
- [] if it isn't agent should be able to create these
- [] agent should add the required packages

## 4. Schema Generation

- [] Send array data to GPT
- [] Generate Drizzle schema (save in `/db/schema/`)
- [] Merge schemas or split as needed
  - as there are two kind of recently played constants

## 5. API Route Generation

- [] Create `GET` route using Drizzle to fetch from DB
- [] Save to `/app/api/<table>/route.ts`

## 6. Migrations & DB Setup

- [] Automatically run `drizzle-kit push` or `generate` via Node CLI
- [] Might insert seed data via `db.insert()`

## 7. GPT Phase 3: Frontend Integration

**Bonus section, will do if get time**

- [] Locate constant usage in frontend
- [] Replace with `useState` + `useEffect` + `fetch('/api/...')`
