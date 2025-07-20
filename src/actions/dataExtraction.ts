import fs from "fs/promises";
import {
  extractLocalImports,
  extractArrayConstants,
  parseArrayConstants,
} from "../helperFunctions";

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

    const dataset = await fs.readFile(dir + "/src/app/page.tsx", "utf-8");

    // Extract and print imports only for page.tsx
    const localImports = extractLocalImports(dataset);
    if (localImports.length === 0) {
      console.log("No local/component imports found.");
      return "No local/component imports found - no data to extract";
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
        const componentContent = await fs.readFile(componentFilePath, "utf-8");
        const constants = extractArrayConstants(
          componentContent,
          componentFilePath
        );
        arrayConstants.push(...constants);
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
          arrayConstants.push(...constants);
        } catch (err2) {
          console.log(
            `Could not read component file for import: ${importPath}`
          );
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
          const componentContent = await fs.readFile(
            componentFilePath,
            "utf-8"
          );
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
        } tables with data`;
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
