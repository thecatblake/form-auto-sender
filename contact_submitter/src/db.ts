import { Pool } from "pg";

export interface SubmissionResult {
    id: string,
    profile_name: string,
    host: string,
    contact_url: string,
    result: string,
    created_at: string
}

const connectionString = `postgres://localuser:streamcrewadmin@192.168.100.8:5432/formautosender`;

export const pool = new Pool({
  connectionString
});

export async function query<T>(text: string, params?: any[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}
