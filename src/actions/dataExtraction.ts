import fs from "fs/promises";
import path from "path";
import {
  extractLocalImports,
  extractArrayConstants,
  parseArrayConstants,
} from "../helperFunctions";

// Helper function to recursively find all page.tsx files in app directory
async function findAllPageFiles(dir: string): Promise<string[]> {
  const pageFiles: string[] = [];

  async function scanDirectory(currentDir: string) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Skip api folder entirely
          if (entry.name === "api") {
            continue;
          }
          // Recursively scan subdirectories
          await scanDirectory(fullPath);
        } else if (entry.name === "page.tsx") {
          pageFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.log(`Could not scan directory: ${currentDir}`);
    }
  }

  const appDir = path.join(dir, "src", "app");
  await scanDirectory(appDir);

  return pageFiles;
}

// Action: Get the dataset for the project
export async function getDataset(dir: string) {
  try {
    // Check if data.json already exists
    try {
      const dataPath = `${dir}/data.json`;
      await fs.access(dataPath);
      console.log("Data already extracted and saved to data.json");
      return "Data already extracted - skipping extraction";
    } catch (error) {
      // data.json doesn't exist, continue with extraction
      console.log(
        "No existing data.json found, extracting data from components..."
      );
    }

    // Find all page.tsx files in the app directory
    const pageFiles = await findAllPageFiles(dir);

    if (pageFiles.length === 0) {
      console.log("No page.tsx files found in app directory");
      return "No page.tsx files found - no data to extract";
    }

    console.log(`Found ${pageFiles.length} page.tsx files:`);
    pageFiles.forEach((file) => {
      const relativePath = path.relative(path.join(dir, "src"), file);
      console.log(`  - ${relativePath}`);
    });

    const allArrayConstants: string[] = [];
    const allSourceFiles: string[] = [];

    // Process each page.tsx file
    for (const pageFile of pageFiles) {
      console.log(
        `\nProcessing ${path.relative(path.join(dir, "src"), pageFile)}...`
      );

      const dataset = await fs.readFile(pageFile, "utf-8");

      // Extract and print imports for this page
      const localImports = extractLocalImports(dataset);
      if (localImports.length === 0) {
        console.log("No local/component imports found in this page.");
      }

      // Extract array constants for this page
      const pageConstants = extractArrayConstants(
        dataset,
        path.basename(pageFile)
      );
      allArrayConstants.push(...pageConstants);

      // Track source files for page constants
      for (let i = 0; i < pageConstants.length; i++) {
        allSourceFiles.push(pageFile);
      }

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
          // Relative path from the current page file
          const pageDir = path.dirname(pageFile);
          componentFilePath = path.resolve(pageDir, importPath + ".tsx");
        }

        try {
          const componentContent = await fs.readFile(
            componentFilePath,
            "utf-8"
          );
          const constants = extractArrayConstants(
            componentContent,
            componentFilePath
          );
          allArrayConstants.push(...constants);

          // Track source files for each constant found
          for (let i = 0; i < constants.length; i++) {
            allSourceFiles.push(componentFilePath);
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
            allArrayConstants.push(...constants);

            // Track source files for each constant found
            for (let i = 0; i < constants.length; i++) {
              allSourceFiles.push(fallbackPath);
            }
          } catch (err2) {
            console.log(
              `Could not read component file for import: ${importPath}`
            );
          }
        }
      }
    }

    // Parse the array constants and save to data.json
    if (allArrayConstants.length > 0) {
      console.log("Parsing extracted data and saving to data.json...");

      const parsedData = parseArrayConstants(allArrayConstants, allSourceFiles);

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
          const typedDataInfo = dataInfo as {
            data: any[];
            sourceFiles: string[];
          };
          console.log(
            `  - ${tableName}: ${
              typedDataInfo.data.length
            } records (from ${typedDataInfo.sourceFiles.join(", ")})`
          );
        }
        return `Data extracted successfully - found ${
          Object.keys(parsedData).length
        } tables with data from ${pageFiles.length} pages`;
      } else {
        console.log("No valid data found to save");
        return "No valid data found to save";
      }
    } else {
      return "No array constants found in components";
    }
  } catch (error) {
    console.error("Error extracting data:", error);
    return `Error extracting data: ${error}`;
  }
}
