import fs from "fs/promises";
import { execSync } from "child_process";
import { logSection, logSubsection } from "./loggingFunctions";

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

export async function drizzleOrmSetup(dir: string) {
  let drizzleStatus = false;
  try {
    const file = await fs.readFile(dir + "/package.json", "utf-8");
    if (
      JSON.parse(file).dependencies?.["drizzle-orm"] ||
      JSON.parse(file).devDependencies?.["drizzle-orm"]
    ) {
      drizzleStatus = true;
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
      DATABASE_URL=postgresql://postgres:postgres@localhost:5432/spotify`
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

/*
we'll use this prompt inside the agent code to do all this automatically- 
  const prompt = `
      You are a TypeScript and Drizzle ORM expert. 
Given the following JavaScript constants (arrays of objects), generate Drizzle ORM schema definitions in TypeScript using PostgreSQL:

- Use \`uuid('id').primaryKey().defaultRandom()\` for IDs (if they are string-based).
- Use \`varchar()\` instead of \`text()\` for short string fields like \`title\`, \`artist\`, etc.
- Use \`notNull()\` for always-present fields, otherwise mark them with \`optional()\`.
- Use appropriate column types: varchar for strings, integer for duration, etc.
- Merge constants if they have similar structure and table name (e.g., recentlyPlayed1 and recentlyPlayed2).
- if table constants names are similar, merge them into a single table
- Don't merge tables if the name or purpose is different like madeForYou and recentlyPlayed.
- Return only valid TypeScript code with named \`export const\` for each table using \`pgTable\`.


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

*/
