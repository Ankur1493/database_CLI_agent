import fs from "fs/promises";

import figlet from "figlet";
import { Command } from "commander";

const program = new Command();
const options = program.opts();

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
      default:
        console.log("No action specified");
        break;
    }
  })
  .option("-n, --name <name>", "Name of the database", "db cragen")
  .option("-l, --ls <path>", "List directory contents")
  .option("-i, --imports <path>", "Get imports")
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

function extractArrayConstants(content: string, fileLabel: string) {
  logSubsection(`Data constants in ${fileLabel}`);
  const arrayConstants = content.match(
    /const\s+\w+\s*=\s*\[[^\]]*,[^\]]+\];/gm
  );
  if (arrayConstants && arrayConstants.length > 0) {
    arrayConstants.forEach((constant) => console.log(constant));
  } else {
    console.log("No data constants found.");
  }
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
  logSection("Analyzing src/app/page.tsx");
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
      extractArrayConstants(componentContent, componentFilePath);
    } catch (err) {
      // Try index.tsx fallback for folders
      try {
        const fallbackPath = componentFilePath.replace(/\.tsx$/, "/index.tsx");
        logSection(`Analyzing ${fallbackPath}`);
        const componentContent = await fs.readFile(fallbackPath, "utf-8");
        extractArrayConstants(componentContent, fallbackPath);
      } catch (err2) {
        logSection(`Could not read component file for import: ${importPath}`);
      }
    }
  }
}
