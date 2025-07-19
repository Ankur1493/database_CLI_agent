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
  return arrayConstants;
}

// helper function to generate the drizzle orm schema
export async function generateDrizzleSchema(
  dir: string,
  arrayConstants: string[]
) {
  // we'll use this prompt inside the agent code to do all this automatically-
  console.log("generating the drizzle orm schema...");
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
