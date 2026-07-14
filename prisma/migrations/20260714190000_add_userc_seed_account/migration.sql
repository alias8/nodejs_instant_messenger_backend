-- Seed a permanent, non-guest "userC" account used as a silent third
-- contact in the guest demo (added manually via +New Chat, never logs in
-- or replies — the password hash below is unusable, same pattern as guest
-- accounts in POST /users/guest).
INSERT INTO "User" ("id", "username", "password_hash", "is_guest", "created_at")
VALUES (
    '00000000-0000-0000-0000-00000000000c',
    'userC',
    '$2b$10$/H.VadkkkSR3nErfQd4dSe8n9f0JxzmzPwTcE9INnJ9tvzWnba.t.',
    false,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("username") DO NOTHING;
