import fs from "fs/promises";
import { execSync } from "child_process";
import { logSection, logSubsection } from "./loggingFunctions";
import { OpenAI } from "openai";
import { dir } from "console";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// helper function to check if the project is a next js project
export async function accessProject(dir: string) {
  try {
    await fs.access(dir);
    console.log("We are processing the path");
  } catch (err) {
    console.error(
      `Error: The path "${dir}" does not exist or is inaccessible.`
    );
    return;
  }
  const projectStatus = await fs.readFile(dir + "/package.json", "utf-8");
  const projectStatusJson = JSON.parse(projectStatus);
  if (
    projectStatusJson.dependencies?.next ||
    projectStatusJson.devDependencies?.next
  ) {
    console.log("Project is ready to go");
    return true;
  } else {
    console.log("You need to provide a next js project");
    return false;
  }
}

// helper function to setup drizzle orm
export async function drizzleOrmSetup(dir: string) {
  let drizzleStatus = false;
  try {
    const file = await fs.readFile(dir + "/package.json", "utf-8");
    if (
      JSON.parse(file).dependencies?.["drizzle-orm"] ||
      JSON.parse(file).devDependencies?.["drizzle-orm"]
    ) {
      drizzleStatus = true;
      console.log("Drizzle orm is already installed");
      return true;
    }
  } catch (err) {
    console.log("No drizzle config file found");
    return false;
  }
  if (!drizzleStatus) {
    try {
      console.log("Installing necessary packages...");
      execSync("npm install drizzle-orm postgres --legacy-peer-deps", {
        cwd: dir,
        stdio: "inherit",
      });
      execSync("npm install --save-dev drizzle-kit --legacy-peer-deps", {
        cwd: dir,
        stdio: "inherit",
      });
      console.log("Installed drizzle kit and drizzle orm successfully");

      console.log("Creating drizzle config...");
      await fs.writeFile(
        dir + "/drizzle.config.ts",
        `import { defineConfig } from 'drizzle-kit';

      export default defineConfig({
        schema: './src/drizzle/schema.ts',
        out: './src/drizzle/migrations',
        dialect: 'postgresql',
        dbCredentials: {
          url: process.env.DATABASE_URL as string,
        },
      });`,
        "utf-8"
      );
      await fs.appendFile(
        dir + "/.env",
        `#this is assumed to be a local postgres database
      DATABASE_URL=postgres://postgres:postgres@localhost:5432/mydb`
      );
      console.log("Drizzle config created");
    } catch (error) {
      console.log("Error installing drizzle orm");
      console.dir(error);
      return false;
    }
  }
  return true;
}

// helper function to extract array constants from a file
function extractArrayConstants(content: string, fileLabel: string): string[] {
  //  logSubsection(`Data constants in ${fileLabel}`);

  console.log(`Extracting the constant data from ${fileLabel}...`);
  const constRegex = /const\s+(\w+)(?:\s*:\s*([^=]+))?\s*=\s*[\r\n]*\[/gm;
  const arrayConstants: string[] = [];

  let match;
  while ((match = constRegex.exec(content)) !== null) {
    const constName = match[1];
    const startIndex = match.index ?? 0;

    // Find where the array starts after the '='
    const equalSignIndex = content.indexOf("=", startIndex);
    const arrayStart = content.indexOf("[", equalSignIndex);

    if (arrayStart === -1) continue;

    let bracketCount = 0;
    let arrayEnd = -1;

    for (let i = arrayStart; i < content.length; i++) {
      const char = content[i];
      if (char === "[") bracketCount++;
      if (char === "]") bracketCount--;
      if (bracketCount === 0) {
        arrayEnd = i;
        break;
      }
    }

    if (arrayEnd === -1) continue;

    const fullArray = content.substring(arrayStart, arrayEnd + 1).trim();

    // Validation: skip arrays that are empty, too small, or don't contain objects
    const objectMatches = [...fullArray.matchAll(/\{[^}]*\}/g)];

    if (
      objectMatches.length < 2 || // Require at least 2 objects
      fullArray === "[]" || // Skip explicitly empty arrays
      !fullArray.includes("{") || // Must have object structure
      !fullArray.includes("}") ||
      fullArray.length < 20 // Skip very short inline values like [0]
    ) {
      continue;
    }

    const fullConstant = `const ${constName} = ${fullArray};`;
    arrayConstants.push(fullConstant);
  }

  if (arrayConstants.length > 0) {
    console.log(`\nFound data in ${fileLabel}`);
    return arrayConstants;
  } else {
    console.log(`No data found in ${fileLabel}`);
  }
  return [];
}

// helper function to extract local imports from a file for tracking components
function extractLocalImports(content: string): string[] {
  console.log("Finding the components you have used in the project...");
  const importRegex = /^import\s+.*?from\s+['\"][^'\"]+['\"];?$/gm;
  const imports = content.match(importRegex);
  if (!imports) {
    console.log(`No imports found in page.tsx`);
    return [];
  }
  return imports.filter((imp) => {
    const match = imp.match(/from\s+['\"]([^'\"]+)['\"]/);
    const importPath = match?.[1];
    console.log("Found this component: ", importPath);
    return (
      importPath && (importPath.startsWith(".") || importPath.startsWith("@"))
    );
  });
}

// helper function to get the dataset for the project
export async function getDataset(dir: string) {
  //  logSection("Analyzing src/app/page.tsx");
  const dataset = await fs.readFile(dir + "/src/app/page.tsx", "utf-8");

  // Extract and print imports only for page.tsx
  logSubsection("Local component imports in page.tsx");
  const localImports = extractLocalImports(dataset);
  if (localImports.length === 0) {
    console.log("No local/component imports found.");
    return [];
  }

  // Extract array constants for page.tsx
  extractArrayConstants(dataset, "page.tsx");

  const arrayConstants = [];
  // For each local/aliased import, try to read the file and extract array constants
  for (const imp of localImports) {
    const match = imp.match(/from\s+['\"]([^'\"]+)['\"]/);
    const importPath = match?.[1];
    if (!importPath) continue;
    let componentFilePath = "";
    if (importPath.startsWith("@")) {
      // Replace @ with dir/src (assuming @ is alias for src)
      componentFilePath = dir + "/src" + importPath.slice(1) + ".tsx";
    } else if (importPath.startsWith(".")) {
      // Relative path from page.tsx
      componentFilePath = dir + "/src/app/" + importPath + ".tsx";
    }
    try {
      logSection(`Analyzing ${componentFilePath}`);
      const componentContent = await fs.readFile(componentFilePath, "utf-8");
      const constants = extractArrayConstants(
        componentContent,
        componentFilePath
      );
      arrayConstants.push(...constants);
    } catch (err) {
      // Try index.tsx fallback for folders
      try {
        const fallbackPath = componentFilePath.replace(/\.tsx$/, "/index.tsx");
        logSection(`Analyzing ${fallbackPath}`);
        const componentContent = await fs.readFile(fallbackPath, "utf-8");
        const constants = extractArrayConstants(componentContent, fallbackPath);
        arrayConstants.push(...constants);
      } catch (err2) {
        logSection(`Could not read component file for import: ${importPath}`);
      }
    }
  }

  // Parse the array constants and save to data.json
  if (arrayConstants.length > 0) {
    console.log("Parsing extracted data and saving to data.json...");
    const parsedData = parseArrayConstants(arrayConstants);

    if (Object.keys(parsedData).length > 0) {
      // Save the parsed data to data.json
      const dataFilePath = `${dir}/data.json`;
      await fs.writeFile(
        dataFilePath,
        JSON.stringify(parsedData, null, 2),
        "utf-8"
      );
      console.log(`Data saved to ${dataFilePath}`);

      // Log summary of extracted data
      console.log(`\nExtracted data summary:`);
      for (const [tableName, data] of Object.entries(parsedData)) {
        console.log(`  - ${tableName}: ${data.length} records`);
      }
    } else {
      console.log("No valid data found to save");
    }
  }

  return arrayConstants;
}

// helper function to read parsed data from data.json
export async function getParsedData(
  dir: string
): Promise<Record<string, any[]>> {
  try {
    const dataFilePath = `${dir}/data.json`;
    const dataContent = await fs.readFile(dataFilePath, "utf-8");
    const parsedData = JSON.parse(dataContent);
    console.log(`Loaded data from ${dataFilePath}`);
    console.log(`Found ${Object.keys(parsedData).length} tables with data`);

    return parsedData;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      console.log(
        "No data.json file found. Please run 'imports' command first to extract data."
      );
    } else {
      console.log("Error reading data.json:", error);
    }
    return {};
  }
}

// helper function to generate the drizzle orm schema
export async function generateDrizzleSchema(dir: string) {
  console.log("generating the drizzle orm schema...");

  // Get parsed data from data.json
  const parsedData = await getParsedData(dir);

  if (Object.keys(parsedData).length === 0) {
    console.log(
      "No data found. Please run 'imports' command first to extract data."
    );
    return;
  }

  // Convert parsed data back to array constants format for the AI prompt
  const arrayConstants: string[] = [];
  for (const [tableName, data] of Object.entries(parsedData)) {
    const arrayContent = JSON.stringify(data, null, 2);
    const fullConstant = `const ${tableName} = ${arrayContent};`;
    arrayConstants.push(fullConstant);
  }

  const prompt = `
      You are a TypeScript and Drizzle ORM expert. 
Given the following JavaScript constants (arrays of objects), generate Drizzle ORM schema definitions in TypeScript using PostgreSQL:

IMPORTANT RULES:
- Use \`uuid('id').primaryKey().defaultRandom()\` for IDs (if they are string-based).
- Use \`varchar()\` instead of \`text()\` for short string fields like \`title\`, \`artist\`, etc.
- Use \`notNull()\` for always-present fields, otherwise leave fields optional (no additional parameters).
- Use appropriate column types: varchar for strings, integer for duration, etc.
- MERGE arrays with EXACTLY the same constant name by creating a unified schema that includes ALL fields from both structures.
- For example, if you have 'recentlyPlayed' with 'subtitle' and another 'recentlyPlayed' with 'artist'/'album', create one table with: id, title, subtitle, artist, album, image, duration.
- Make fields optional (no .notNull()) if they don't exist in all arrays with the same name.
- Create SEPARATE tables for different constant names (e.g., 'madeForYou' and 'popularAlbums' should be separate tables).
- Return only valid TypeScript code with named \`export const\` for each table using \`pgTable\`.
- Include the import statement: \`import { pgTable, uuid, varchar, integer } from 'drizzle-orm/pg-core';\`

Analyze each constant array carefully and create separate tables for each unique constant name, merging only arrays with identical names.

Dataset:
${arrayConstants.join("\n")}      `;
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a Drizzle ORM + TypeScript expert",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const responseContent = response.choices[0]?.message?.content ?? "";
  // Remove markdown code block markers only
  const importLineMatch = responseContent.match(
    /^(?:\s*\/\/\s*)?\s*import\s+\{[^}]+\}\s+from\s+['"]drizzle-orm\/pg-core['"];?/m
  );
  const importLine =
    importLineMatch?.[0]
      ?.replace(/^\s*\/\/\s*/, "") // Remove leading comment
      .trim() ?? "";
  const schemaBlocks = [
    ...responseContent.matchAll(/export const .*?pgTable\([\s\S]+?\}\);/g),
  ];

  const schemaContent = schemaBlocks.map((match) => match[0]).join("\n\n");

  const processedContent = `${importLine}\n\n${schemaContent}`;
  // Ensure the drizzle directory exists before writing files
  const drizzleDir = `${dir}/src/drizzle`;
  await fs.mkdir(drizzleDir, { recursive: true });

  await Promise.all([
    fs.writeFile(drizzleDir + "/schema.ts", processedContent),
    fs.writeFile(
      drizzleDir + "/db.ts",
      `import { drizzle } from "drizzle-orm/postgres-js";
    import * as schema from "./schema";
    import postgres from "postgres";

    const client = postgres(process.env.DATABASE_URL as string);

    export const db = drizzle(client, { schema, logger: true });
  `
    ),

    fs.writeFile(
      drizzleDir + "/migrate.ts",
      `import dotenv from "dotenv";
dotenv.config({path: ".env"});
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function runMigrations() {
  const migrationClient = postgres(process.env.DATABASE_URL as string, {
    max: 1,
  });

  try {
    await migrate(drizzle(migrationClient), {
      migrationsFolder: "./src/drizzle/migrations",
    });
    console.log("Migrations completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await migrationClient.end();
  }
}

runMigrations().catch(console.error);
`
    ),
  ]);

  console.log("Drizzle orm schema generated successfully", processedContent);

  // Generate migrations using drizzle-kit
  try {
    console.log("Generating database migrations...");
    execSync("npx drizzle-kit generate", {
      cwd: dir,
      stdio: "inherit",
    });
    console.log("Database migrations generated successfully");

    // Install tsx if not available
    console.log("Installing tsx for TypeScript execution...");
    execSync("npm install --save-dev dotenv tsx --legacy-peer-deps", {
      cwd: dir,
      stdio: "inherit",
    });

    // Run migrations to update the database
    console.log("Running database migrations...");
    execSync("npx tsx src/drizzle/migrate.ts", {
      cwd: dir,
      stdio: "inherit",
    });
    console.log("Database migrations applied successfully");
  } catch (error) {
    console.log("Error during database operations:", error);
    console.log("You can manually run the following commands:");
    console.log("1. npx drizzle-kit generate");
    console.log("2. npm install --save-dev tsx --legacy-peer-deps");
    console.log("3. npx tsx src/drizzle/migrate.ts");
  }
}

// helper function to seed the database with array constants data
export async function seedDatabase(dir: string) {
  console.log("Seeding the database with extracted data...");

  // Get parsed data from data.json
  const parsedData = await getParsedData(dir);

  if (Object.keys(parsedData).length === 0) {
    console.log(
      "No data found. Please run 'imports' command first to extract data."
    );
    return;
  }

  try {
    console.log(`Found ${Object.keys(parsedData).length} tables to seed:`);
    for (const [tableName, data] of Object.entries(parsedData)) {
      console.log(`  - ${tableName}: ${data.length} records`);
    }

    // Generate seed file
    const seedContent = generateSeedFile(parsedData);

    // Ensure the drizzle directory exists
    const drizzleDir = `${dir}/src/drizzle`;
    await fs.mkdir(drizzleDir, { recursive: true });

    // Write seed file
    await fs.writeFile(drizzleDir + "/seed.ts", seedContent, "utf-8");

    console.log("Seed file generated successfully");

    // Run the seed script
    console.log("Running database seeding...");
    execSync("npx tsx src/drizzle/seed.ts", {
      cwd: dir,
      stdio: "inherit",
    });
    console.log("Database seeded successfully");
  } catch (error) {
    console.log("Error during database seeding:", error);
    console.log("You can manually run the following command:");
    console.log("npx tsx src/drizzle/seed.ts");
  }
}

// Helper function to parse array constants into structured data
function parseArrayConstants(arrayConstants: string[]): Record<string, any[]> {
  const parsedData: Record<string, any[]> = {};

  console.log(`Processing ${arrayConstants.length} array constants`);

  for (const constant of arrayConstants) {
    try {
      // Extract constant name and array content
      const constMatch = constant.match(
        /const\s+(\w+)\s*=\s*(\[.*?\])\s*;?\s*$/s
      );
      if (!constMatch || !constMatch[1] || !constMatch[2]) {
        console.log("Failed to match constant pattern");
        console.log("Constant string:", constant.substring(0, 100) + "...");
        continue;
      }

      const constName = constMatch[1];
      const arrayContent = constMatch[2];

      console.log(`Parsing constant: ${constName}`);
      console.log(`Array content length: ${arrayContent.length}`);

      // Try to parse using a more robust approach
      const extractedArray = extractArrayFromString(arrayContent);
      if (extractedArray && extractedArray.length > 0) {
        // Merge with existing data if constant name already exists
        if (parsedData[constName]) {
          console.log(`Merging data for existing constant: ${constName}`);
          parsedData[constName] = [...parsedData[constName], ...extractedArray];
        } else {
          parsedData[constName] = extractedArray;
        }
        console.log(
          `Successfully parsed ${extractedArray.length} items for ${constName}`
        );
      } else {
        console.log(`Failed to extract data for ${constName}`);
      }
    } catch (error) {
      console.log(`Error parsing constant: ${error}`);
    }
  }

  // Now normalize the data to ensure all records have the same fields
  const normalizedData: Record<string, any[]> = {};

  for (const [tableName, data] of Object.entries(parsedData)) {
    console.log(`Normalizing data for ${tableName}...`);

    // Collect all unique field names from all records
    const allFields = new Set<string>();
    data.forEach((record) => {
      Object.keys(record).forEach((key) => allFields.add(key));
    });

    console.log(`Found fields for ${tableName}:`, Array.from(allFields));

    // Deduplicate records based on id field
    const uniqueRecords = new Map<string, any>();
    data.forEach((record) => {
      const id = record.id;
      if (id) {
        if (uniqueRecords.has(id)) {
          // Merge fields from duplicate records
          const existingRecord = uniqueRecords.get(id);
          const mergedRecord = { ...existingRecord };

          // Update with non-null values from the new record
          Object.keys(record).forEach((key) => {
            if (record[key] !== null && record[key] !== undefined) {
              mergedRecord[key] = record[key];
            }
          });

          uniqueRecords.set(id, mergedRecord);
          console.log(`Merged duplicate record with id ${id}`);
        } else {
          uniqueRecords.set(id, record);
        }
      } else {
        // If no id, just add the record
        uniqueRecords.set(`no-id-${Date.now()}-${Math.random()}`, record);
      }
    });

    // Normalize each record to include all fields
    const normalizedRecords = Array.from(uniqueRecords.values()).map(
      (record) => {
        const normalizedRecord: any = {};
        allFields.forEach((field) => {
          normalizedRecord[field] = record[field] || null; // Use null for missing fields
        });
        return normalizedRecord;
      }
    );

    normalizedData[tableName] = normalizedRecords;
    console.log(
      `Normalized ${normalizedRecords.length} unique records for ${tableName}`
    );
  }

  console.log(`Final parsed data keys:`, Object.keys(normalizedData));
  return normalizedData;
}

// Helper function to extract array data from string when JSON parsing fails
function extractArrayFromString(arrayString: string): any[] {
  try {
    // Try to evaluate the array string as JavaScript
    // This is safer than eval() and can handle JavaScript object syntax
    const arrayData = new Function(`return ${arrayString}`)();

    if (Array.isArray(arrayData)) {
      console.log(
        `Successfully extracted ${arrayData.length} objects using Function constructor`
      );
      return arrayData;
    } else {
      console.log("Extracted data is not an array");
      return [];
    }
  } catch (error) {
    console.log(`Function constructor failed: ${error}`);

    // Fallback to manual parsing
    return extractArrayManually(arrayString);
  }
}

// Fallback manual parsing function
function extractArrayManually(arrayString: string): any[] {
  const objects: any[] = [];
  let currentObject = "";
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let inArray = false;

  for (let i = 0; i < arrayString.length; i++) {
    const char = arrayString[i];

    if (escapeNext) {
      currentObject += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      currentObject += char;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
    }

    if (!inString) {
      if (char === "[") {
        inArray = true;
        continue;
      } else if (char === "]") {
        inArray = false;
        break;
      } else if (char === "{") {
        braceCount++;
        if (braceCount === 1) {
          currentObject = "{";
          continue;
        }
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          // End of object
          currentObject += "}";
          try {
            // Try to evaluate the object as JavaScript
            const parsedObj = new Function(`return ${currentObject}`)();
            objects.push(parsedObj);
            console.log(`Successfully parsed object manually:`, parsedObj);
          } catch (e) {
            console.log(`Failed to parse object manually: ${currentObject}`);
            console.log(`Error:`, e);
          }
          currentObject = "";
          continue;
        }
      }
    }

    if (braceCount > 0) {
      currentObject += char;
    }
  }

  console.log(`Manually extracted ${objects.length} objects from array string`);
  return objects;
}

// Helper function to generate the seed file content
function generateSeedFile(parsedData: Record<string, any[]>): string {
  let seedContent = `import dotenv from "dotenv";
dotenv.config({path: ".env"});
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL as string);
const db = drizzle(client, { schema, logger: true });

async function seedDatabase() {
  try {
    console.log("Starting database seeding...");
`;

  // Generate insert statements for each table
  for (const [tableName, data] of Object.entries(parsedData)) {
    if (data.length === 0) continue;

    // Convert table name to camelCase for schema reference
    const schemaTableName =
      tableName.charAt(0).toLowerCase() + tableName.slice(1);

    // Remove 'id' field from data since schema auto-generates UUIDs
    const dataWithoutId = data.map((item) => {
      const { id, ...itemWithoutId } = item;
      return itemWithoutId;
    });

    seedContent += `
    // Seeding ${tableName} table
    console.log(\`Seeding \${${
      dataWithoutId.length
    }} records into ${tableName} table...\`);
    const ${tableName}Data = ${JSON.stringify(dataWithoutId, null, 4)};
    
    for (const record of ${tableName}Data) {
      try {
        await db.insert(schema.${schemaTableName}).values(record);
      } catch (error) {
        console.log(\`Error inserting record into ${tableName}:\`, error);
      }
    }
    console.log(\`${tableName} table seeded successfully\`);
`;
  }

  seedContent += `
    console.log("Database seeding completed successfully");
  } catch (error) {
    console.error("Error during seeding:", error);
    throw error;
  } finally {
    await client.end();
  }
}

seedDatabase().catch(console.error);
`;

  return seedContent;
}
