-- Knowledge MCP clients may hide an immutable private asset without deleting
-- its stored bytes. The repository limits this to unpublished assets that are
-- not referenced by a current active page; no storage-delete capability is
-- granted to the MCP process.

GRANT UPDATE (deleted_at) ON assets TO context_use_mcp;
