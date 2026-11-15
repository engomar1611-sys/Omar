-- 055: speed up date-scoped general-ledger financial statements.
CREATE INDEX IF NOT EXISTS ix_journal_entries_posted_date
 ON journal_entries(entry_date,id) WHERE status='posted';
CREATE INDEX IF NOT EXISTS ix_journal_lines_account_entry
 ON journal_lines(account_id,journal_entry_id);
