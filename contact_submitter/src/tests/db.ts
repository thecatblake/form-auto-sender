import { query, SubmissionResult } from "../db";

async function main() {
  // SELECT
  const users = await query<SubmissionResult>("SELECT * FROM submission_result");
  console.log("users:", users);
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(() => {
    // pool.end();
  });