# database-cli-agent

To install dependencies:

```bash
bun install
```
```
You might need to add open ai api key
```

To run:

```bash
bun run index.ts
```

# File overview
- src/index.ts - Main CLI application that sets up the AI agent loop, handles user input, and handles the workflow between different actions using OpenAI GPT-4
- src/prompts/index.ts - Defines all system prompts for GPT-4 including the main workflow instructions, API generation prompts, schema generation prompts, and validation logic
- src/helperFunctions.ts - Contains utility functions for extracting array constants from files, parsing data, managing data.json, and providing helper methods for table status tracking and data retrieval

**Action Modules**
- src/actions/projectSetup.ts - Handles project validation (ensures it's a Next.js project) and sets up Drizzle ORM by installing packages and creating configuration files
- src/actions/validation.ts - Validates user requests against available data to ensure the requested operations can be fulfilled with the extracted data
- src/actions/dataExtraction.ts - Extracts array constants from page.tsx files and imported components, then saves the parsed data to data.json for further processing
- src/actions/schemaGeneration.ts - Uses GPT to generate Drizzle ORM schema files based on the extracted data structure and saves them to the database schema directory
- src/actions/databaseSeeding.ts - Seeds the database with the extracted data using Drizzle ORM and tracks seeding status for each table
- src/actions/granularOperations.ts - Provides granular control for generating schemas and seeding specific tables rather than processing all data at once
- src/actions/apiRouteGeneration.ts - Generates Next.js API routes using GPT based on the database schema, creating CRUD endpoints for the specified tables


# Workflow
## ai store recently played songs in database
- first our AI would use the drizzle setup tool to see if drizzle config is there or not
- after that we run an extract command which basically goes through the pages inside the app folder and there relative components this catches the constants in those files like const movies = [{mckdmcdkc}, {cmkkcdd}]
- then we are validating the requests (this doesn't matter for the first runs, but after we have extracted the data we can check if user asks for storing movies in songs db, we cna just invalidate the req)
- after this we are now generating schema for a particular table ( if you go back some commits I was generating schema and seeding all in one commands and just skip it other thimes)
- seeding similar to schema process

```note - this doesn't generate the api rouet and frontend integration```

## ai create api for made for you and popular albums
- first our AI would use the drizzle setup tool to see if drizzle config is there or not
- after that we run an extract command which basically goes through the pages inside the app folder and there relative components this catches the constants in those files like const movies = [{mckdmcdkc}, {cmkkcdd}]
- then we are validating the requests (this doesn't matter for the first runs, but after we have extracted the data we can check if user asks for storing movies in songs db, we cna just invalidate the req)
- after this we are now generating schema for a particular table ( if you go back some commits I was generating schema and seeding all in one commands and just skip it other thimes)
- seeding similar to schema process
- In here we send the details to openAI and it generates the frontend and backend code


# Assumptions
- We are tackling smaller projects as for extracting projects we are not doing indexing or such things
- Constants data would be inside the files only this is being use to track which frontend file to update when we create an api route
- All next js projects
- Not storing user queries and our ai responses - if we do that we can have a much better experience 

# Improvements
- We can have indexing of project files for better understanding
- Better AI prompts for handling more things like generating completely new table and data
- Better frontend integrations at the moment I have assumed that we'll just use useState and useEffect - but what we can do is if we keep proper indexing and all we can call the data server side on maybe parent page.tsx and pass in the data to the component
- Having more better logs and terminal currently you have to write the local relative path to the project and run each command using ai beforehand 

# Phases for development

## 1. Initial Setup

- [x] Break the assignment into parts
- [x] Setup the project

## 2. CLI Tool

- [x] Setup CLI with commander js
- [x] Print CLI logs: "Agent is thinking...", "Editing file...", etc.

## 3. File traversing and data retrieval

- [x] Confirm the path for project from the user
- [x] Parse `app/page.tsx` - taking an assumption atm for spotify project - but later we might have multiple pages - so can add a question or something to verify which page
- [x] Resolve and read all imported components
- [x] Extract constants from components
- [x] Detect duplicate dataset names (e.g. `recentlyPlayed`) and resolve conflicts
  - Got the constants it's in string only atm - thinking to pass it as an array only to API might be better for models to understood

## 5. Drizzle init

- [x] Check if there is a dirzzle config,schema and all
- [x] if it isn't agent should be able to create these
- [x] agent should add the required packages

## 6. Schema Generation

- [x] Send array data to GPT
- [x] Generate Drizzle schema (save in `/db/schema/`)
- [x] Merge schemas or split as needed
  - as there are two kind of recently played constants

## 7. API Route Generation

- [x] Create `GET` route using Drizzle to fetch from DB
- [x] Save to `/app/api/<table>/route.ts`

## 8. Migrations & DB Setup

- [x] Automatically run `drizzle-kit push` or `generate` via Node CLI
- [x] Insert seed data via `db.insert()` with the new seed command

## 9 . GPT Phase 3: Frontend Integration

**Bonus section, will do if get time**

- [x] Locate constant usage in frontend
- [x] Replace with `useState` + `useEffect` + `fetch('/api/...')`
- [x] Adding validations for requests (there are cases that it might fail) 

## 10. Separating the logic for schema generation and seeding
- [x] We are generating schema for all tables together
- [x] need to make it more separate basically per table
