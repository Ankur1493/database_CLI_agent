import fs from "fs/promises";
import { execSync } from "child_process";

// Action: Check if the project is a next js project
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

// Action: Setup drizzle orm
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
      return "Drizzle orm is already installed successfully";
    }
  } catch (err) {
    console.log("No drizzle config file found");
    return "Failed to check drizzle status - no package.json found";
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
      return "Drizzle orm installed and configured successfully";
    } catch (error) {
      console.log("Error installing drizzle orm");
      console.dir(error);
      return "Failed to install drizzle orm - installation error occurred";
    }
  }
  return "Drizzle orm setup completed successfully";
}
