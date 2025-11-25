import { query } from "../db";

export interface SubmissionResult {
  id: string;
  profile_id: string;
  host: string | null;
  contact_url: string | null;
  result: string | null;
  created_at: Date;
}

export interface CreateSubmissionResultInput {
  profile_id: string;
  host?: string;
  contact_url?: string;
  result?: string;
}

export interface ListSubmissionResult {
  profile_name: string;
  host: string | null;
  contact_url: string | null;
  result: string | null;
  created_at: Date;
}

export async function createSubmissionResult(
  input: CreateSubmissionResultInput
): Promise<SubmissionResult> {
  const { profile_id, host, contact_url, result } = input;

  const res = await query<SubmissionResult>(
    `
    INSERT INTO submission_result (profile_id, host, contact_url, result)
    VALUES ($1, $2, $3, $4)
    RETURNING id, profile_id, host, contact_url, result, created_at
    `,
    [
      profile_id,
      host ?? null,
      contact_url ?? null,
      result ?? null,
    ]
  );

  return res[0];
}


export async function listSubmission(): Promise<ListSubmissionResult[]> {
  return await query<ListSubmissionResult>(
    `
    SELECT 
      submit_profile.name AS profile_name,
      submission_result.host,
      submission_result.contact_url,
      submission_result.result,
      submission_result.created_at
    FROM submission_result
    INNER JOIN submit_profile
      ON submit_profile.id = submission_result.profile_id;
    `
  );
}