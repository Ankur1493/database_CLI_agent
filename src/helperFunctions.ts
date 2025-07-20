import fs from "fs/promises";
import { execSync } from "child_process";
import { OpenAI } from "openai";
import { dir } from "console";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// helper function to extract array constants from a file
export function extractArrayConstants(
  content: string,
  fileLabel: string
): string[] {
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
export function extractLocalImports(content: string): string[] {
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

// helper function to read parsed data from data.json
export async function getParsedData(dir: string): Promise<
  Record<
    string,
    {
      data: any[];
      sourceFiles: string[];
      status?: { schemaGenerated?: boolean; seeded?: boolean };
    }
  >
> {
  try {
    // First try the project directory
    const dataFilePath = `${dir}/data.json`;
    const dataContent = await fs.readFile(dataFilePath, "utf-8");
    const parsedData = JSON.parse(dataContent);
    console.log(`Loaded data from ${dataFilePath}`);
    console.log(`Found ${Object.keys(parsedData).length} tables with data`);

    return parsedData;
  } catch (error) {
    // If not found in project directory, try current directory
    try {
      const currentDirDataPath = `./data.json`;
      const dataContent = await fs.readFile(currentDirDataPath, "utf-8");
      const parsedData = JSON.parse(dataContent);
      console.log(`Loaded data from ${currentDirDataPath}`);
      console.log(`Found ${Object.keys(parsedData).length} tables with data`);

      return parsedData;
    } catch (currentDirError) {
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
}

// Helper function to update table status in data.json
export async function updateTableStatus(
  dir: string,
  tableName: string,
  status: { schemaGenerated?: boolean; seeded?: boolean }
): Promise<void> {
  try {
    // First try the project directory
    let dataFilePath = `${dir}/data.json`;
    let existingData: any = {};

    // Read existing data.json if it exists
    try {
      const existingContent = await fs.readFile(dataFilePath, "utf-8");
      existingData = JSON.parse(existingContent);
    } catch (readError) {
      // If not found in project directory, try current directory
      try {
        dataFilePath = `./data.json`;
        const existingContent = await fs.readFile(dataFilePath, "utf-8");
        existingData = JSON.parse(existingContent);
      } catch (currentDirError) {
        console.log("Creating new data.json file for status tracking");
      }
    }

    // Initialize table status if it doesn't exist
    if (!existingData[tableName]) {
      existingData[tableName] = { data: [], sourceFiles: [], status: {} };
    }

    // Update the status
    if (!existingData[tableName].status) {
      existingData[tableName].status = {};
    }

    if (status.schemaGenerated !== undefined) {
      existingData[tableName].status.schemaGenerated = status.schemaGenerated;
    }
    if (status.seeded !== undefined) {
      existingData[tableName].status.seeded = status.seeded;
    }

    // Write updated data back to data.json
    await fs.writeFile(
      dataFilePath,
      JSON.stringify(existingData, null, 2),
      "utf-8"
    );
    console.log(
      `Updated status for table ${tableName}:`,
      existingData[tableName].status
    );
  } catch (error) {
    console.log(`Error updating table status for ${tableName}:`, error);
    throw error;
  }
}

// Helper function to get table status
export async function getTableStatus(
  dir: string,
  tableName: string
): Promise<{ schemaGenerated: boolean; seeded: boolean }> {
  try {
    const parsedData = await getParsedData(dir);
    const tableData = parsedData[tableName];

    if (!tableData) {
      return { schemaGenerated: false, seeded: false };
    }

    return {
      schemaGenerated: tableData.status?.schemaGenerated || false,
      seeded: tableData.status?.seeded || false,
    };
  } catch (error) {
    console.log(`Error getting table status for ${tableName}:`, error);
    return { schemaGenerated: false, seeded: false };
  }
}

// Helper function to get tables that need schema generation
export async function getTablesNeedingSchema(dir: string): Promise<string[]> {
  try {
    const parsedData = await getParsedData(dir);
    const tablesNeedingSchema: string[] = [];

    for (const [tableName, tableData] of Object.entries(parsedData)) {
      if (tableName === "apiRoutes") continue; // Skip apiRoutes table

      const status = tableData.status || {};
      if (!status.schemaGenerated) {
        tablesNeedingSchema.push(tableName);
      }
    }

    return tablesNeedingSchema;
  } catch (error) {
    console.log("Error getting tables needing schema:", error);
    return [];
  }
}

// Helper function to get tables that need seeding
export async function getTablesNeedingSeeding(dir: string): Promise<string[]> {
  try {
    const parsedData = await getParsedData(dir);
    const tablesNeedingSeeding: string[] = [];

    for (const [tableName, tableData] of Object.entries(parsedData)) {
      if (tableName === "apiRoutes") continue; // Skip apiRoutes table

      const status = tableData.status || {};
      if (status.schemaGenerated && !status.seeded) {
        tablesNeedingSeeding.push(tableName);
      }
    }

    return tablesNeedingSeeding;
  } catch (error) {
    console.log("Error getting tables needing seeding:", error);
    return [];
  }
}

// Helper function to parse array constants into structured data
export function parseArrayConstants(
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

// Helper function to extract table name from user query using GPT
export async function extractTableNameFromQuery(
  userQuery: string,
  availableTables: string[]
): Promise<string | null> {
  if (availableTables.length === 0) {
    return null;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a database assistant that helps identify which table a user wants to work with based on their query.

AVAILABLE TABLES: ${availableTables.join(", ")}

TASK: Analyze the user's query and determine which table they want to work with. Return ONLY the exact table name from the available tables list, or "null" if no table matches.

RULES:
1. Return the EXACT table name as it appears in the AVAILABLE TABLES list
2. Be flexible and understand synonyms, descriptions, and natural language
3. If the user mentions multiple tables, return the most relevant one
4. If no table matches, return "null"
5. Return ONLY the table name or "null" - no explanations

EXAMPLES:
- "store recently played music" → "recentlyPlayed"
- "create API for users" → "users" (if users table exists)
- "seed products table" → "products" (if products table exists)
- "generate schema for orders" → "orders" (if orders table exists)
- "store customer data" → "customers" (if customers table exists)`,
        },
        {
          role: "user",
          content: `User query: "${userQuery}"`,
        },
      ],
      temperature: 0.1,
      max_tokens: 50,
    });

    const result = response.choices[0]?.message?.content?.trim();

    if (!result || result === "null") {
      return null;
    }

    // Verify the result is actually in our available tables
    const matchedTable = availableTables.find(
      (table) => table.toLowerCase() === result.toLowerCase()
    );

    return matchedTable || null;
  } catch (error) {
    console.log("Error extracting table name with GPT:", error);
    return null;
  }
}
