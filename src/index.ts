import figlet from "figlet";
import { Command } from "commander";

const program = new Command();

program
  .version("1.0.0")
  .description("A CLI for the Spotify Clone")
  .option("-n, --name <name>", "Name of the database", "db cragen")
  .option("-d, --database <database>", "Database to use", "postgres")
  .parse(process.argv);

const options = program.opts();

figlet("Spotify Clone", (err, data) => {
  if (err) {
    console.log("Something went wrong...");
    console.dir(err);
    return;
  }
  console.log(data);
});
