import fs from "fs/promises";
import { execSync } from "child_process";
import { OpenAI } from "openai";
import {
  getParsedData,
  updateTableStatus,
  getTableStatus,
  getTablesNeedingSchema,
  getTablesNeedingSeeding,
} from "../helperFunctions";
import { SCHEMA_PROMPT } from "../prompts";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Action: Generate schema for specific table(s)
export async function generateSchemaForTables(
  dir: string,
  tableNames?: string[]
) {
  console.log("Generating schema for specific tables...");

  // Get parsed data from data.json
  const parsedData = await getParsedData(dir);

  if (Object.keys(parsedData).length === 0) {
    console.log(
      "No data found. Please run 'imports' command first to extract data."
    );
    return "No data found - please run extract-data first";
  }

  // If no specific tables provided, get all tables that need schema generation
  let tablesToProcess = tableNames;
  if (!tablesToProcess || tablesToProcess.length === 0) {
    tablesToProcess = await getTablesNeedingSchema(dir);
    if (tablesToProcess.length === 0) {
      console.log("All tables already have schemas generated.");
      return "All tables already have schemas generated";
    }
  }

  console.log(`Generating schema for tables: ${tablesToProcess.join(", ")}`);

  // Filter parsed data to only include requested tables
  const filteredData: Record<string, { data: any[]; sourceFiles: string[] }> =
    {};
  for (const tableName of tablesToProcess) {
    if (parsedData[tableName]) {
      filteredData[tableName] = parsedData[tableName];
    } else {
      console.log(`Warning: Table ${tableName} not found in extracted data`);
    }
  }

  if (Object.keys(filteredData).length === 0) {
    console.log("No valid tables found to generate schema for.");
    return "No valid tables found to generate schema for";
  }

  // Convert filtered data back to array constants format for the AI prompt
  const arrayConstants: string[] = [];
  for (const [tableName, dataInfo] of Object.entries(filteredData)) {
    const arrayContent = JSON.stringify(dataInfo.data, null, 2);
    const fullConstant = `const ${tableName} = ${arrayContent};`;
    arrayConstants.push(fullConstant);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a Drizzle ORM + TypeScript expert",
        },
        {
          role: "user",
          content: SCHEMA_PROMPT(arrayConstants),
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

    // Clean up any potential import issues and ensure all necessary types are imported
    const cleanedContent = processedContent
      .replace(
        /import\s+\{[^}]*float[^}]*\}\s+from\s+['"]drizzle-orm\/pg-core['"];?/g,
        "import { pgTable, uuid, varchar, integer, boolean, text, real, timestamp, date, json, jsonb, decimal, numeric, smallint, bigint, doublePrecision, serial, bigserial, smallserial } from 'drizzle-orm/pg-core';"
      )
      .replace(/float\(/g, "real(")
      .replace(/double\(/g, "doublePrecision(")
      .replace(/number\(/g, "integer(");

    // Read existing schema file if it exists
    let existingSchemaContent = "";
    try {
      existingSchemaContent = await fs.readFile(
        `${dir}/src/drizzle/schema.ts`,
        "utf-8"
      );
    } catch (error) {
      // Schema file doesn't exist, we'll create it
    }

    // Merge new schema with existing schema
    const mergedSchema = mergeSchemas(existingSchemaContent, cleanedContent);

    // Ensure the drizzle directory exists before writing files
    const drizzleDir = `${dir}/src/drizzle`;
    await fs.mkdir(drizzleDir, { recursive: true });

    // Write the merged schema
    await fs.writeFile(`${drizzleDir}/schema.ts`, mergedSchema, "utf-8");

    // Create db.ts file
    await fs.writeFile(
      `${drizzleDir}/db.ts`,
      `import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL as string);

export const db = drizzle(client, { schema, logger: true });
`,
      "utf-8"
    );

    // Create migrate.ts file
    await fs.writeFile(
      `${drizzleDir}/migrate.ts`,
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
`,
      "utf-8"
    );

    console.log("Schema generated successfully for specified tables");

    // Update status for each processed table
    for (const tableName of tablesToProcess) {
      if (parsedData[tableName]) {
        await updateTableStatus(dir, tableName, { schemaGenerated: true });
      }
    }

    // Check if any of the processed tables need database operations
    const tablesNeedingSeeding = await getTablesNeedingSeeding(dir);
    const tablesThatNeedDbOps = tablesToProcess.filter((table) =>
      tablesNeedingSeeding.includes(table)
    );

    if (tablesThatNeedDbOps.length === 0) {
      console.log(
        "All processed tables already have database operations completed. Skipping migrations and seeding."
      );
      return `Schema generated successfully for tables: ${tablesToProcess.join(
        ", "
      )} - database operations already completed`;
    }

    // Only run database operations for tables that need them
    try {
      console.log("Generating database migrations...");

      // Check if we actually need to generate migrations by looking at existing ones
      const migrationsDir = `${dir}/src/drizzle/migrations`;
      let needsMigration = true;

      try {
        const migrationFiles = await fs.readdir(migrationsDir);
        const sqlFiles = migrationFiles.filter((file) => file.endsWith(".sql"));

        if (sqlFiles.length > 0) {
          // Check if the tables we're processing already exist in migrations
          const latestMigration = sqlFiles.sort().pop();
          if (latestMigration) {
            const latestMigrationContent = await fs.readFile(
              `${migrationsDir}/${latestMigration}`,
              "utf-8"
            );

            // Check if all tables already exist in the latest migration
            const allTablesExist = tablesToProcess.every((table) => {
              const tableName = table
                .toLowerCase()
                .replace(/([A-Z])/g, "_$1")
                .toLowerCase();
              return latestMigrationContent.includes(
                `CREATE TABLE "${tableName}"`
              );
            });

            if (allTablesExist) {
              console.log(
                "All tables already exist in database. Skipping migration generation."
              );
              needsMigration = false;
            }
          }
        }
      } catch (fsError) {
        // If we can't read migrations directory, assume we need migrations
        console.log(
          "Could not check existing migrations, proceeding with generation..."
        );
      }

      if (needsMigration) {
        // Try to generate migrations with automatic conflict resolution
        try {
          execSync("npx drizzle-kit generate", {
            cwd: dir,
            stdio: "inherit",
          });
        } catch (migrationError) {
          console.log(
            "Migration generation failed due to conflicts. Skipping migration step."
          );
          console.log("You may need to manually resolve table conflicts.");
          console.log("Manual command: npx drizzle-kit generate");
        }
      }

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

      return `Schema generated and database migrations applied successfully for tables: ${tablesToProcess.join(
        ", "
      )}`;
    } catch (error) {
      console.log("Error during database operations:", error);
      console.log("You can manually run the following commands:");
      console.log("1. npx drizzle-kit generate");
      console.log("2. npm install --save-dev tsx --legacy-peer-deps");
      console.log("3. npx tsx src/drizzle/migrate.ts");
      return `Schema generated but database migrations failed for tables: ${tablesToProcess.join(
        ", "
      )} - check console for manual commands`;
    }
  } catch (error) {
    console.error("Error generating schema:", error);
    return `Error generating schema: ${error}`;
  }
}

// Action: Seed specific table(s)
export async function seedSpecificTables(dir: string, tableNames?: string[]) {
  console.log("Seeding specific tables...");

  // Get parsed data from data.json
  const parsedData = await getParsedData(dir);

  if (Object.keys(parsedData).length === 0) {
    console.log(
      "No data found. Please run 'imports' command first to extract data."
    );
    return "No data found - please run extract-data first";
  }

  // If no specific tables provided, get all tables that need seeding
  let tablesToProcess = tableNames;
  if (!tablesToProcess || tablesToProcess.length === 0) {
    tablesToProcess = await getTablesNeedingSeeding(dir);
    if (tablesToProcess.length === 0) {
      console.log("All tables already seeded or don't have schemas generated.");
      return "All tables already seeded or don't have schemas generated";
    }
  } else {
    // Check if the specifically requested tables are already seeded
    const tablesNeedingSeeding = await getTablesNeedingSeeding(dir);
    const alreadySeededTables = tablesToProcess.filter(
      (table) => !tablesNeedingSeeding.includes(table)
    );

    if (alreadySeededTables.length > 0) {
      console.log(
        `Warning: The following tables are already seeded: ${alreadySeededTables.join(
          ", "
        )}`
      );
      console.log("Skipping already seeded tables to avoid duplicates.");
    }

    // Filter out already seeded tables
    tablesToProcess = tablesToProcess.filter((table) =>
      tablesNeedingSeeding.includes(table)
    );

    if (tablesToProcess.length === 0) {
      console.log("All requested tables are already seeded.");
      return "All requested tables are already seeded";
    }
  }

  console.log(`Seeding tables: ${tablesToProcess.join(", ")}`);

  // Filter parsed data to only include requested tables
  const filteredData: Record<string, { data: any[]; sourceFiles: string[] }> =
    {};
  for (const tableName of tablesToProcess) {
    if (parsedData[tableName]) {
      filteredData[tableName] = parsedData[tableName];
    } else {
      console.log(`Warning: Table ${tableName} not found in extracted data`);
    }
  }

  if (Object.keys(filteredData).length === 0) {
    console.log("No valid tables found to seed.");
    return "No valid tables found to seed";
  }

  try {
    // Generate seed file for specific tables
    const seedContent = generateSeedFileForTables(filteredData);

    // Ensure the drizzle directory exists
    const drizzleDir = `${dir}/src/drizzle`;
    await fs.mkdir(drizzleDir, { recursive: true });

    // Write seed file
    await fs.writeFile(`${drizzleDir}/seed.ts`, seedContent, "utf-8");

    console.log("Seed file generated successfully for specified tables");

    // Run the seed script
    console.log("Running database seeding...");
    execSync("npx tsx src/drizzle/seed.ts", {
      cwd: dir,
      stdio: "inherit",
    });
    console.log("Database seeded successfully for specified tables");

    // Update status for each processed table
    for (const tableName of tablesToProcess) {
      if (parsedData[tableName]) {
        await updateTableStatus(dir, tableName, { seeded: true });
      }
    }

    return `Database seeded successfully for tables: ${tablesToProcess.join(
      ", "
    )}`;
  } catch (error) {
    console.log("Error during database seeding:", error);
    console.log("You can manually run the following command:");
    console.log("npx tsx src/drizzle/seed.ts");
    return `Database seeding failed for tables: ${tablesToProcess.join(
      ", "
    )} - check console for manual command`;
  }
}

// Helper function to merge schemas
function mergeSchemas(existingSchema: string, newSchema: string): string {
  if (!existingSchema.trim()) {
    return newSchema;
  }

  // Extract import statements from both schemas
  const existingImportMatch = existingSchema.match(
    /import\s+\{[^}]+\}\s+from\s+['"]drizzle-orm\/pg-core['"];?/
  );
  const newImportMatch = newSchema.match(
    /import\s+\{[^}]+\}\s+from\s+['"]drizzle-orm\/pg-core['"];?/
  );

  // Merge import statements by combining all unique types
  const allTypes = new Set<string>();

  if (existingImportMatch) {
    const existingTypes =
      existingImportMatch[0].match(/\{([^}]+)\}/)?.[1] || "";
    existingTypes
      .split(",")
      .map((t) => t.trim())
      .forEach((type) => allTypes.add(type));
  }

  if (newImportMatch) {
    const newTypes = newImportMatch[0].match(/\{([^}]+)\}/)?.[1] || "";
    newTypes
      .split(",")
      .map((t) => t.trim())
      .forEach((type) => allTypes.add(type));
  }

  // Create comprehensive import statement with all needed types
  const comprehensiveImportStatement = `import { ${Array.from(allTypes).join(
    ", "
  )} } from 'drizzle-orm/pg-core';`;

  // Extract table definitions from both schemas
  const existingTables = [
    ...existingSchema.matchAll(
      /export const (\w+)\s*=\s*pgTable\([\s\S]+?\}\);/g
    ),
  ];
  const newTables = [
    ...newSchema.matchAll(/export const (\w+)\s*=\s*pgTable\([\s\S]+?\}\);/g),
  ];

  // Create a map of existing tables
  const existingTableMap = new Map();
  existingTables.forEach((match) => {
    existingTableMap.set(match[1], match[0]);
  });

  // Merge new tables with existing ones (new tables override existing ones)
  newTables.forEach((match) => {
    existingTableMap.set(match[1], match[0]);
  });

  // Combine comprehensive import statement with all table definitions
  const allTables = Array.from(existingTableMap.values()).join("\n\n");

  return `${comprehensiveImportStatement}\n\n${allTables}`;
}

// Helper function to generate seed file content for specific tables
function generateSeedFileForTables(
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
    console.log("Starting database seeding for specific tables...");
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
    console.log("Database seeding completed successfully for specified tables");
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
