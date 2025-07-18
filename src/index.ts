import fs from "fs/promises";
import { execSync } from "child_process";

import figlet from "figlet";
import { Command } from "commander";
import OpenAI from "openai";

const program = new Command();
const options = program.opts();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

figlet("Spotify Clone", (err, data) => {
  if (err) {
    console.log("Something went wrong...");
    console.dir(err);
    return;
  }
  console.log(data);
});

program
  .version("1.0.0")
  .description("A CLI for the Spotify Clone")
  .action(() => {
    switch (true) {
      case !!options.ls:
        accessProject(options.ls);
        break;
      case !!options.imports:
        getDataset(options.imports);
        break;
      case !!options.drizzle:
        checkDrizzleStatus(options.drizzle);
        break;
      default:
        console.log("No action specified");
        break;
    }
  })
  .option("-n, --name <name>", "Name of the database", "db cragen")
  .option("-l, --ls <path>", "List directory contents")
  .option("-i, --imports <path>", "Get imports")
  .option("-d, --drizzle <path>", "Check drizzle config")
  .parse(process.argv);

async function accessProject(dir: string) {
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
  } else {
    console.log("You need to provide a next js project");
    return;
  }

  const projectName = projectStatusJson.name;
  console.log(`Project name: ${projectName}`);
}

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

function logSubsection(subtitle: string) {
  console.log("\n" + "-".repeat(40));
  console.log(subtitle);
  console.log("-".repeat(40));
}

function extractArrayConstants(content: string, fileLabel: string): string[] {
  //  logSubsection(`Data constants in ${fileLabel}`);

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
    console.log("\nFound array constants:");
    // Extract and print titles from the array objects
    arrayConstants.forEach((constant) => {
      const match = constant.match(/const\s+(\w+)\s*=\s*(\[[\s\S]*\]);/);
      if (match && match[2]) {
        const constantName = match[1];
        const arrayContent = match[2];

        try {
          // Use a more robust approach to extract titles
          const titleMatches = arrayContent.match(
            /title:\s*['"`]([^'"`]+)['"`]/g
          );
          if (titleMatches) {
            const titles = titleMatches
              .map((match) => {
                const titleMatch = match.match(/title:\s*['"`]([^'"`]+)['"`]/);
                return titleMatch ? titleMatch[1] : "";
              })
              .filter((title): title is string => Boolean(title));

            console.log(`\n${constantName}:`);
            titles.forEach((title: string) => console.log(`  - ${title}`));
          } else {
            console.log(`\n${constantName}: No titles found`);
          }
        } catch (error) {
          console.log(`Error parsing ${constantName}: ${error}`);
        }
      }
    });
  } else {
    console.log("No array constants found.");
  }

  return arrayConstants;
}

function extractLocalImports(content: string): string[] {
  const importRegex = /^import\s+.*?from\s+['\"][^'\"]+['\"];?$/gm;
  const imports = content.match(importRegex);
  if (!imports) return [];
  return imports.filter((imp) => {
    const match = imp.match(/from\s+['\"]([^'\"]+)['\"]/);
    const importPath = match?.[1];
    return (
      importPath && (importPath.startsWith(".") || importPath.startsWith("@"))
    );
  });
}

async function getDataset(dir: string) {
  //  logSection("Analyzing src/app/page.tsx");
  const dataset = await fs.readFile(dir + "/src/app/page.tsx", "utf-8");

  // Extract and print imports only for page.tsx
  logSubsection("Local component imports in page.tsx");
  const localImports = extractLocalImports(dataset);
  if (localImports.length > 0) {
    localImports.forEach((imp) => console.log(imp));
  } else {
    console.log("No local/component imports found.");
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
  const drizzleSchemaCode = response.choices[0]?.message?.content;
  console.log({ drizzleSchemaCode });
}

async function checkDrizzleStatus(dir: string) {
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
  }
  if (!drizzleStatus) {
    try {
      console.log("Installing drizzle orm...");
      execSync("npm install drizzle-orm postgres --legacy-peer-deps", {
        cwd: dir,
        stdio: "inherit",
      });
      console.log("Drizzle orm installed");
      execSync("npm install --save-dev drizzle-kit --legacy-peer-deps", {
        cwd: dir,
        stdio: "inherit",
      });
      console.log("Drizzle kit installed");

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
        dir + ".env",
        `#this is assumed to be a local postgres database
      DATABASE_URL=postgresql://postgres:postgres@localhost:5432/spotify`
      );
      console.log("Drizzle config created");
    } catch (error) {
      console.log("Error installing drizzle orm");
      console.dir(error);
      return;
    }
  }
}
