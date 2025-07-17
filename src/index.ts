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
    if (options.ls) {
      if (options.ls) {
        accessProject(options.ls);
      } else {
        console.log("You must specify the path to the file or directory");
      }
    } else {
      console.log("No action specified");
    }
  })
  .option("-n, --name <name>", "Name of the database", "db cragen")
  .option("-l, --ls <path>", "List directory contents")
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
