import { OpenAI } from "openai";
import { getParsedData } from "../helperFunctions";
import { VALIDATION_PROMPT } from "../prompts";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Action: Validate user request against available data
export async function validateUserRequest(dir: string, userQuery: string) {
  console.log("Validating user request against available data...");

  // Get parsed data from data.json
  const parsedData = await getParsedData(dir);

  if (Object.keys(parsedData).length === 0) {
    console.log(
      "No data found. Please run 'imports' command first to extract data."
    );
    return "No data found - please run extract-data first";
  }

  // Get available table names
  const availableTables = Object.keys(parsedData).filter(
    (table) => table !== "apiRoutes"
  );
  console.log("Available tables:", availableTables);

  // Create a summary of available data for validation
  const dataSummary = availableTables.map((tableName) => {
    const dataInfo = parsedData[tableName];
    if (!dataInfo) {
      return {
        tableName,
        recordCount: 0,
        sampleFields: [],
        sampleData: {},
      };
    }
    const sampleRecord = dataInfo.data.length > 0 ? dataInfo.data[0] : {};
    return {
      tableName,
      recordCount: dataInfo.data.length,
      sampleFields: Object.keys(sampleRecord),
      sampleData: sampleRecord,
    };
  });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a data validation expert. Analyze user requests against available data and provide clear validation results.",
        },
        {
          role: "user",
          content: VALIDATION_PROMPT(userQuery, dataSummary),
        },
      ],
    });

    const validationResult =
      response.choices[0]?.message?.content?.trim() || "Validation failed";
    console.log(`Validation result: ${validationResult}`);

    return validationResult;
  } catch (error) {
    console.error("Error during validation:", error);
    return `Error during validation: ${error}`;
  }
}
