import fs from "fs/promises";
import { execSync } from "child_process";
import { getParsedData } from "../helperFunctions";

// Action: Seed the database with array constants data
export async function seedDatabase(dir: string) {
  console.log("Seeding the database with extracted data...");

  // Check if database has already been seeded by looking for seed file
  try {
    const seedPath = `${dir}/src/drizzle/seed.ts`;
    await fs.access(seedPath);
    console.log("Seed file already exists at src/drizzle/seed.ts");
    console.log(
      "Database may have already been seeded. Skipping seeding to avoid duplicates."
    );
    return "Database already seeded - skipping to avoid duplicates";
  } catch (error) {
    // Seed file doesn't exist, continue with seeding
    console.log(
      "No existing seed file found, proceeding with database seeding..."
    );
  }

  // Get parsed data from data.json
  const parsedData = await getParsedData(dir);

  if (Object.keys(parsedData).length === 0) {
    console.log(
      "No data found. Please run 'imports' command first to extract data."
    );
    return "No data found - please run extract-data first";
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
    return "Database seeded successfully";
  } catch (error) {
    console.log("Error during database seeding:", error);
    console.log("You can manually run the following command:");
    console.log("npx tsx src/drizzle/seed.ts");
    return "Database seeding failed - check console for manual command";
  }
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
