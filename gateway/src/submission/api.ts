import { query } from "../db";

export interface SubmissionResult {
  id: string;
  profile_id: string;
  target_id: number | null;
  contact_url: string | null;
  result: string | null;
  created_at: Date;
}

export interface CreateSubmissionResultInput {
  profile_id: string;
  target_id?: number;
  contact_url?: string;
  result?: string;
}

export async function createSubmissionResult(
  input: CreateSubmissionResultInput
): Promise<SubmissionResult> {
  const { profile_id, target_id, contact_url, result } = input;

  const res = await query<SubmissionResult>(
    `
    INSERT INTO submission_result (profile_id, target_id, contact_url, result)
    VALUES ($1, $2, $3, $4)
    RETURNING id, profile_id, target_id, contact_url, result, created_at
    `,
    [
      profile_id,
      target_id ?? null,
      contact_url ?? null,
      result ?? null,
    ]
  );

  return res[0];
}
