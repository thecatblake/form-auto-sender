CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS submission_result (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_name TEXT,
    target_id integer,
    contact_url TEXT,
    result TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)