import { query } from "../db";

export interface SubmitProfile {
  id: string;
  name: string;
  body: string | null;
  created_at: Date;
}

export interface CreateSubmitProfileInput {
  name: string;
  body?: string;
}

export interface UpdateSubmitProfileInput {
  id: string;
  name?: string;
  body?: string;
}



export async function createSubmitProfile(
  input: CreateSubmitProfileInput
): Promise<SubmitProfile> {
  const { name, body } = input;

  const result = await query<SubmitProfile>(
    `
    INSERT INTO submit_profile (name, body)
    VALUES ($1, $2)
    RETURNING id, name, body, created_at
    `,
    [name, body ?? null]
  );

  return result[0];
}

export async function updateSubmitProfile(
  input: UpdateSubmitProfileInput
): Promise<SubmitProfile | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(input.name);
  }

  if (input.body !== undefined) {
    fields.push(`body = $${idx++}`);
    values.push(input.body);
  }

  if (fields.length === 0) {
    // 変更なし
    return null;
  }

  values.push(input.id); // WHERE 用
  const result = await query<SubmitProfile>(
    `
    UPDATE submit_profile
    SET ${fields.join(", ")}
    WHERE id = $${idx}
    RETURNING id, name, body, created_at
    `,
    values
  );

  return result[0] ?? null;
}


export async function getSubmitProfile(id: string): Promise<SubmitProfile | null> {
  const result = await query<SubmitProfile>(
    `
    SELECT id, name, body, created_at
    FROM submit_profile
    WHERE id = $1
    `,
    [id]
  );

  return result[0] ?? null;
}

export async function listSubmitProfiles(): Promise<SubmitProfile[]> {
  return await query<SubmitProfile>(
    `
    SELECT id, name, body, created_at
    FROM submit_profile
    ORDER BY created_at DESC
    `
  );
}
