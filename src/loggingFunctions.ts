export function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

export function logSubsection(subtitle: string) {
  console.log("\n" + "-".repeat(40));
  console.log(subtitle);
  console.log("-".repeat(40));
}
