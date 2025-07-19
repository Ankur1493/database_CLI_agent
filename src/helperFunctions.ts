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

    // Track source files for each constant
    const sourceFiles: string[] = [];
    for (const imp of localImports) {
      const match = imp.match(/from\s+['\"]([^'\"]+)['\"]/);
      const importPath = match?.[1];
      if (!importPath) continue;

      let componentFilePath = "";
      if (importPath.startsWith("@")) {
        componentFilePath = dir + "/src" + importPath.slice(1) + ".tsx";
      } else if (importPath.startsWith(".")) {
        componentFilePath = dir + "/src/app/" + importPath + ".tsx";
      }

      // Add source file for each constant found in this file
      try {
        const componentContent = await fs.readFile(componentFilePath, "utf-8");
        const constants = extractArrayConstants(
          componentContent,
          componentFilePath
        );
        // Add the source file for each constant found
        for (let i = 0; i < constants.length; i++) {
          sourceFiles.push(componentFilePath);
        }
      } catch (err) {
        // Try index.tsx fallback for folders
        try {
          const fallbackPath = componentFilePath.replace(
            /\.tsx$/,
            "/index.tsx"
          );
          const componentContent = await fs.readFile(fallbackPath, "utf-8");
          const constants = extractArrayConstants(
            componentContent,
            fallbackPath
          );
          for (let i = 0; i < constants.length; i++) {
            sourceFiles.push(fallbackPath);
          }
        } catch (err2) {
          // Skip if file not found
        }
      }
    }

    const parsedData = parseArrayConstants(arrayConstants, sourceFiles);

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
      for (const [tableName, dataInfo] of Object.entries(parsedData)) {
        console.log(
          `  - ${tableName}: ${
            dataInfo.data.length
          } records (from ${dataInfo.sourceFiles.join(", ")})`
        );
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
): Promise<Record<string, { data: any[]; sourceFiles: string[] }>> {
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
  for (const [tableName, dataInfo] of Object.entries(parsedData)) {
    const arrayContent = JSON.stringify(dataInfo.data, null, 2);
    const fullConstant = `const ${tableName} = ${arrayContent};`;
    arrayConstants.push(fullConstant);
  }

  const prompt = `
      You are a TypeScript and Drizzle ORM expert. 
Given the following JavaScript constants (arrays of objects), generate Drizzle ORM schema definitions in TypeScript using PostgreSQL:

IMPORTANT RULES:
- Use \`uuid('id').primaryKey().defaultRandom()\` for IDs (if they are string-based).
- Use \`varchar()\` instead of \`text()\` for short string fields like \`title\`, \`artist\`, etc.
- For optional fields, just use the column type without any additional methods (e.g., \`varchar()\` not \`varchar().optional()\`).
- For required fields, use \`.notNull()\` method.
- Use appropriate column types: varchar for strings, integer for numbers, boolean for booleans, etc.
- MERGE arrays with EXACTLY the same constant name by creating a unified schema that includes ALL fields from both structures.
- For example, if you have 'recentlyPlayed' with 'subtitle' and another 'recentlyPlayed' with 'artist'/'album', create one table with: id, title, subtitle, artist, album, image, duration.
- Create SEPARATE tables for different constant names (e.g., 'madeForYou' and 'popularAlbums' should be separate tables).
- Return only valid TypeScript code with named \`export const\` for each table using \`pgTable\`.
- Include the import statement: \`import { pgTable, uuid, varchar, integer, boolean, text } from 'drizzle-orm/pg-core';\`
- DO NOT use \`.optional()\` method - it doesn't exist in Drizzle ORM.

CORRECT SYNTAX EXAMPLES:
- Required field: \`varchar('title').notNull()\`
- Optional field: \`varchar('subtitle')\` (no additional methods)
- Primary key: \`uuid('id').primaryKey().defaultRandom()\`

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
    for (const [tableName, dataInfo] of Object.entries(parsedData)) {
      console.log(`  - ${tableName}: ${dataInfo.data.length} records`);
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
function parseArrayConstants(
  arrayConstants: string[],
  sourceFiles: string[]
): Record<string, { data: any[]; sourceFiles: string[] }> {
  const parsedData: Record<string, { data: any[]; sourceFiles: string[] }> = {};

  console.log(`Processing ${arrayConstants.length} array constants`);

  for (let i = 0; i < arrayConstants.length; i++) {
    const constant = arrayConstants[i];
    if (!constant) continue;
    const sourceFile = sourceFiles[i] || "unknown";

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

      console.log(`Parsing constant: ${constName} from ${sourceFile}`);
      console.log(`Array content length: ${arrayContent.length}`);

      // Try to parse using a more robust approach
      const extractedArray = extractArrayFromString(arrayContent);
      if (extractedArray && extractedArray.length > 0) {
        // Merge with existing data if constant name already exists
        if (parsedData[constName]) {
          console.log(`Merging data for existing constant: ${constName}`);
          parsedData[constName].data = [
            ...parsedData[constName].data,
            ...extractedArray,
          ];
          // Add source file if not already present
          if (!parsedData[constName].sourceFiles.includes(sourceFile)) {
            parsedData[constName].sourceFiles.push(sourceFile);
          }
        } else {
          parsedData[constName] = {
            data: extractedArray,
            sourceFiles: [sourceFile],
          };
        }
        console.log(
          `Successfully parsed ${extractedArray.length} items for ${constName} from ${sourceFile}`
        );
      } else {
        console.log(`Failed to extract data for ${constName}`);
      }
    } catch (error) {
      console.log(`Error parsing constant: ${error}`);
    }
  }

  // Now normalize the data to ensure all records have the same fields
  const normalizedData: Record<string, { data: any[]; sourceFiles: string[] }> =
    {};

  for (const [tableName, dataInfo] of Object.entries(parsedData)) {
    console.log(`Normalizing data for ${tableName}...`);

    // Collect all unique field names from all records
    const allFields = new Set<string>();
    dataInfo.data.forEach((record) => {
      Object.keys(record).forEach((key) => allFields.add(key));
    });

    console.log(`Found fields for ${tableName}:`, Array.from(allFields));

    // Deduplicate records based on id field
    const uniqueRecords = new Map<string, any>();
    dataInfo.data.forEach((record) => {
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

    normalizedData[tableName] = {
      data: normalizedRecords,
      sourceFiles: dataInfo.sourceFiles,
    };
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
function generateSeedFile(
  parsedData: Record<string, { data: any[]; sourceFiles: string[] }>
): string {
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
  for (const [tableName, dataInfo] of Object.entries(parsedData)) {
    if (dataInfo.data.length === 0) continue;

    // Convert table name to camelCase for schema reference
    const schemaTableName =
      tableName.charAt(0).toLowerCase() + tableName.slice(1);

    // Remove 'id' field from data since schema auto-generates UUIDs
    const dataWithoutId = dataInfo.data.map((item) => {
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

export async function generateAPIRoute(dir: string, userQuery?: string) {
  console.log("Generating API routes...");

  // Get parsed data from data.json
  const parsedData = await getParsedData(dir);

  if (Object.keys(parsedData).length === 0) {
    console.log(
      "No data found. Please run 'imports' command first to extract data."
    );
    return;
  }

  // Read the schema file
  let schemaContent = "";
  try {
    schemaContent = await fs.readFile(`${dir}/src/drizzle/schema.ts`, "utf-8");
  } catch (error) {
    console.log("Error reading schema file:", error);
    return;
  }

  // Generate API route using GPT with user query and schema
  if (userQuery) {
    await generateAPIRouteWithGPT(dir, userQuery, schemaContent, parsedData);
  } else {
    console.log(
      "Please provide a query to generate API routes for specific tables"
    );
  }
}

async function generateAPIRouteWithGPT(
  dir: string,
  userQuery: string,
  schemaContent: string,
  parsedData: Record<string, { data: any[]; sourceFiles: string[] }>
) {
  console.log(`Generating API route for query: "${userQuery}" using GPT...`);

  const availableTables = Object.keys(parsedData);

  const prompt = `
You are a Next.js App Router API expert. The user wants to create an API route for: "${userQuery}"

AVAILABLE TABLES IN SCHEMA:
${availableTables.join(", ")}

SCHEMA CONTENT:
${schemaContent}

CRITICAL RULES:
1. FIRST, analyze the user query and identify what table they want (e.g., "movies", "songs", "albums", etc.)
2. Check if that table exists in the AVAILABLE TABLES list above
3. If the requested table does NOT exist in the schema, return ONLY the error message: "table not found"
4. If the user is asking for multiple tables, return ONLY the error message: "multiple tables not supported"
5. User query can be anything, so you need to be carefull to see if that even relates with our schema table or not 
6. If the user is asking for a table that is not in the schema, return ONLY the error message: "table not found"

TASK (only if table exists):
1. Create a complete API route file for the identified table
2. Use proper Next.js App Router structure: src/app/api/[routeName]/route.ts
3. Convert table name to kebab-case for the route path (e.g., "recentlyPlayed" becomes "recently-played")
4. Use the EXACT table name from the AVAILABLE TABLES list (do NOT convert to snake_case or any other format)
5. For TABLE_NAME in response, use the EXACT table name as it appears in AVAILABLE TABLES

IMPORTANT REQUIREMENTS:
- Use Drizzle ORM for database operations
- The schema file is located at: src/drizzle/schema.ts
- Import the schema as: import * as schema from '../../../drizzle/schema'
- Import database connection as: import { db } from '../../../drizzle/db'
- Use proper Next.js imports: import { NextRequest, NextResponse } from 'next/server'
- Include these CRUD operations in one route.ts file:
  * GET /api/[route] - Get all records (use ?limit=10&offset=0&search=term) or single record (use ?id=uuid)
  * POST /api/[route] - Create new record
  * DELETE /api/[route] - Delete record (use ?id=uuid)
- Use proper error handling and status codes
- Return JSON responses with success/error flags
- Use the correct table name from the schema (convert to camelCase if needed)

CORRECT DRIZZLE SYNTAX EXAMPLES:
- Select all: db.select().from(schema.tableName)
- Select with where: db.select().from(schema.tableName).where(eq(schema.tableName.id, id))
- Select with like: db.select().from(schema.tableName).where(like(schema.tableName.title, '%' + search + '%'))
- Insert: db.insert(schema.tableName).values(data).returning()
- Delete: db.delete(schema.tableName).where(eq(schema.tableName.id, id)).returning()
- Import eq and like: import { eq, like } from 'drizzle-orm'

EXAMPLE API STRUCTURE:
Create one route.ts file with all CRUD operations:

import { NextRequest, NextResponse } from 'next/server';
import { eq, like } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { db } from '../../../drizzle/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit')) || 10;
  const offset = Number(searchParams.get('offset')) || 0;
  const id = searchParams.get('id');

  if (id) {
    // Get single record by ID
    const record = await db.select().from(schema.tableName).where(eq(schema.tableName.id, id));
    return NextResponse.json({ success: true, data: record });
  }

  // Get all records with optional filtering
  let query = db.select().from(schema.tableName).limit(limit).offset(offset);
  
  const records = await query;
  return NextResponse.json({ success: true, data: records });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const record = await db.insert(schema.tableName).values(body).returning();
  return NextResponse.json({ success: true, data: record });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ success: false, message: 'ID is required' }, { status: 400 });
  }

  const deletedRecord = await db.delete(schema.tableName).where(eq(schema.tableName.id, id)).returning();
  return NextResponse.json({ success: true, data: deletedRecord });
}

RESPONSE FORMAT:
If generating an API route, return the response in this exact format:
ROUTE_NAME: [kebab-case-route-name]
TABLE_NAME: [exact-table-name-from-schema]
[TypeScript code for route.ts]

If sending an error message, return ONLY the error message like "table not found" or "multiple tables not supported".

IMPORTANT: 
- Always start with ROUTE_NAME: and TABLE_NAME: for successful responses
- Use the EXACT table name from the AVAILABLE TABLES list above (e.g., "recentlyPlayed", not "recently_played")
- Do NOT convert table names to snake_case or any other format
- Do not include any explanations or markdown formatting
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a Next.js App Router API expert who generates clean, production-ready API routes using Drizzle ORM. You analyze user queries and intelligently select the most appropriate database table from the provided schema.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const apiRouteContent = response.choices[0]?.message?.content ?? "";

    if (!apiRouteContent.trim()) {
      console.log("❌ Error: No content generated by GPT");
      console.log(
        "Please try again with a different query or check your OpenAI API key."
      );
      return;
    }
    console.log({ apiRouteContent });

    // Check if the response contains error messages from GPT
    const errorKeywords = [
      "can't do that",
      "table not found",
      "multiple tables",
      "not in the schema",
      "cannot",
      "unable to",
    ];

    const hasError = errorKeywords.some((keyword) =>
      apiRouteContent.toLowerCase().includes(keyword)
    );

    if (hasError) {
      console.log("❌ Error: " + apiRouteContent.trim());
      return;
    }

    // Extract route name and table name from GPT response
    const routeNameMatch = apiRouteContent.match(/^ROUTE_NAME:\s*([^\n]+)/);
    const tableNameMatch = apiRouteContent.match(/^TABLE_NAME:\s*([^\n]+)/m);

    if (!routeNameMatch) {
      console.log("❌ Error: No route name found in GPT response");
      console.log("Expected format: ROUTE_NAME: [route-name]");
      return;
    }

    if (!tableNameMatch) {
      console.log("❌ Error: No table name found in GPT response");
      console.log("Expected format: TABLE_NAME: [table-name]");
      return;
    }

    const routeName = routeNameMatch[1]?.trim() ?? "";
    const tableName = tableNameMatch[1]?.trim() ?? "";

    if (!routeName) {
      console.log("❌ Error: Empty route name received from GPT");
      return;
    }

    if (!tableName) {
      console.log("❌ Error: Empty table name received from GPT");
      return;
    }

    // Validate route name format (should be kebab-case)
    if (!/^[a-z0-9-]+$/.test(routeName)) {
      console.log("❌ Error: Invalid route name format");
      console.log("Route name should be kebab-case (e.g., 'recently-played')");
      return;
    }

    // Validate table name exists in available tables
    if (!availableTables.includes(tableName)) {
      console.log(
        `❌ Error: Table name "${tableName}" not found in available tables`
      );
      console.log(`Available tables: ${availableTables.join(", ")}`);
      return;
    }

    console.log(`📋 GPT provided table name: ${tableName}`);

    const codeContent = apiRouteContent
      .replace(/^ROUTE_NAME:\s*[^\n]+\n/, "")
      .replace(/^TABLE_NAME:\s*[^\n]+\n/m, "")
      .trim();

    // Create the API routes directory structure
    const apiDir = `${dir}/src/app/api/${routeName}`;
    await fs.mkdir(apiDir, { recursive: true });

    // Write the API route file
    await fs.writeFile(`${apiDir}/route.ts`, codeContent, "utf-8");
    console.log(
      `✅ API route created successfully: src/app/api/${routeName}/route.ts`
    );
    console.log(`🔗 Route path: /api/${routeName}`);
    console.log(`📝 Generated from query: "${userQuery}"`);

    // Store API route details in data.json for tracking
    try {
      const dataFilePath = `${dir}/data.json`;
      let existingData: any = {};

      // Read existing data.json if it exists
      try {
        const existingContent = await fs.readFile(dataFilePath, "utf-8");
        existingData = JSON.parse(existingContent);
      } catch (readError) {
        // If file doesn't exist or is invalid, start with empty object
        console.log("Creating new data.json file for API route tracking");
      }

      // Initialize apiRoutes array if it doesn't exist
      if (!existingData.apiRoutes) {
        existingData.apiRoutes = [];
      }

      // Add the new API route details
      const apiRouteDetails = {
        routeName: routeName,
        filePath: `src/app/api/${routeName}/route.ts`,
        routePath: `/api/${routeName}`,
        generatedFrom: userQuery,
        createdAt: new Date().toISOString(),
        tableUsed: tableName,
      };

      existingData.apiRoutes.push(apiRouteDetails);

      // Write updated data back to data.json
      await fs.writeFile(
        dataFilePath,
        JSON.stringify(existingData, null, 2),
        "utf-8"
      );
      console.log(`📋 API route details stored in data.json`);
      console.log(
        `📊 Total API routes tracked: ${existingData.apiRoutes.length}`
      );
      generateFrontendFetchCalls(
        dir,
        apiRouteDetails.routePath,
        apiRouteDetails.tableUsed,
        parsedData
      );
    } catch (trackingError) {
      console.log(
        "⚠️ Warning: Could not store API route details in data.json:",
        trackingError
      );
    }
  } catch (error) {
    console.log("❌ Error generating API route with GPT:", error);
    console.log("Please check your OpenAI API key and try again.");
  }
}

async function generateFrontendFetchCalls(
  dir: string,
  routePath: string,
  tableName: string,
  parsedData: Record<string, { data: any[]; sourceFiles: string[] }>
) {
  console.log(`Generating frontend fetch calls for ${tableName}...`);

  // Find the source files for this table
  const tableInfo = parsedData[tableName];
  if (!tableInfo) {
    console.log(`❌ No data found for table: ${tableName}`);
    return;
  }

  const sourceFiles = tableInfo.sourceFiles;
  console.log(`📁 Source files: ${sourceFiles.join(", ")}`);

  // Update all source files that contain this constant
  for (const sourceFile of sourceFiles) {
    console.log(`🔄 Updating ${sourceFile}...`);

    try {
      // Read the source file
      const fileContent = await fs.readFile(sourceFile, "utf-8");

      // Find the constant declaration for this table
      // First, let's check if the constant name exists in the file
      if (!fileContent.includes(tableName)) {
        console.log(
          `❌ Constant name "${tableName}" not found in ${sourceFile}`
        );
        continue;
      }

      // Try multiple regex patterns to find the constant declaration
      let constMatch = null;
      const patterns = [
        // Pattern 1: const name = [array];
        new RegExp(`const\\s+${tableName}\\s*=\\s*\\[[\\s\\S]*?\\];`, "g"),
        // Pattern 2: const name = [array] (without semicolon)
        new RegExp(`const\\s+${tableName}\\s*=\\s*\\[[\\s\\S]*?\\]`, "g"),
        // Pattern 3: const name: type = [array];
        new RegExp(
          `const\\s+${tableName}\\s*:\\s*[^=]*=\\s*\\[[\\s\\S]*?\\];`,
          "g"
        ),
        // Pattern 4: const name: type = [array] (without semicolon)
        new RegExp(
          `const\\s+${tableName}\\s*:\\s*[^=]*=\\s*\\[[\\s\\S]*?\\]`,
          "g"
        ),
      ];

      for (const pattern of patterns) {
        constMatch = fileContent.match(pattern);
        if (constMatch) {
          console.log(`✅ Found constant using pattern: ${pattern.source}`);
          break;
        }
      }

      if (!constMatch) {
        console.log(
          `❌ Could not find constant declaration for ${tableName} in ${sourceFile}`
        );
        console.log(
          `🔍 Debug: File contains "${tableName}" but no matching declaration pattern`
        );
        // Let's show a snippet around where the constant name appears
        const nameIndex = fileContent.indexOf(tableName);
        if (nameIndex !== -1) {
          const start = Math.max(0, nameIndex - 50);
          const end = Math.min(fileContent.length, nameIndex + 50);
          console.log(
            `🔍 Context around "${tableName}": "${fileContent.substring(
              start,
              end
            )}"`
          );
        }
        continue; // Skip this file and continue with others
      }

      // Generate the updated code with useEffect and fetch
      const updatedCode = generateUpdatedComponentCode(
        fileContent,
        tableName,
        routePath
      );

      // Write the updated file
      await fs.writeFile(sourceFile, updatedCode, "utf-8");
      console.log(`✅ Updated ${sourceFile} with fetch calls for ${tableName}`);
    } catch (error) {
      console.log(`❌ Error updating frontend file ${sourceFile}: ${error}`);
    }
  }
}

function generateUpdatedComponentCode(
  fileContent: string,
  tableName: string,
  routePath: string
): string {
  // Add "use client" directive if not present
  let updatedContent = fileContent;
  if (!fileContent.includes('"use client"')) {
    updatedContent = '"use client";\n\n' + fileContent;
  }

  // Add useState and useEffect imports if not present
  if (!fileContent.includes("useState") && !fileContent.includes("useEffect")) {
    const importMatch = fileContent.match(
      /import\s+\{[^}]*\}\s+from\s+['"]react['"]/
    );
    if (importMatch) {
      // Add to existing React import
      updatedContent = updatedContent.replace(
        /import\s+\{([^}]*)\}\s+from\s+['"]react['"]/,
        'import { $1, useState, useEffect } from "react"'
      );
    } else {
      // Add new React import
      updatedContent =
        'import { useState, useEffect } from "react";\n\n' + updatedContent;
    }
  }

  // Find the constant declaration and replace it with useState
  // Try multiple regex patterns to find the constant declaration
  let constMatch = null;
  const patterns = [
    // Pattern 1: const name = [array];
    new RegExp(`const\\s+${tableName}\\s*=\\s*\\[[\\s\\S]*?\\];`, "g"),
    // Pattern 2: const name = [array] (without semicolon)
    new RegExp(`const\\s+${tableName}\\s*=\\s*\\[[\\s\\S]*?\\]`, "g"),
    // Pattern 3: const name: type = [array];
    new RegExp(
      `const\\s+${tableName}\\s*:\\s*[^=]*=\\s*\\[[\\s\\S]*?\\];`,
      "g"
    ),
    // Pattern 4: const name: type = [array] (without semicolon)
    new RegExp(`const\\s+${tableName}\\s*:\\s*[^=]*=\\s*\\[[\\s\\S]*?\\]`, "g"),
  ];

  for (const pattern of patterns) {
    constMatch = updatedContent.match(pattern);
    if (constMatch) {
      console.log(
        `✅ Found constant for replacement using pattern: ${pattern.source}`
      );
      break;
    }
  }

  if (constMatch) {
    const originalConstant = constMatch[0];
    const useStateDeclaration = `const [${tableName}, set${
      tableName.charAt(0).toUpperCase() + tableName.slice(1)
    }] = useState([]);`;

    // Add useEffect after the useState declaration
    const useEffectCode = `
  useEffect(() => {
    const fetch${
      tableName.charAt(0).toUpperCase() + tableName.slice(1)
    } = async () => {
      try {
        const response = await fetch('${routePath}');
        const result = await response.json();
        if (result.success) {
          set${
            tableName.charAt(0).toUpperCase() + tableName.slice(1)
          }(result.data);
        }
      } catch (error) {
        console.error('Error fetching ${tableName}:', error);
      }
    };
    
    fetch${tableName.charAt(0).toUpperCase() + tableName.slice(1)}();
  }, []);`;

    // Replace the constant with useState and add useEffect
    updatedContent = updatedContent.replace(
      originalConstant,
      useStateDeclaration + useEffectCode
    );
  }

  return updatedContent;
}
