-- Authority answers who may advance a document; representation answers how
-- its bytes are stored and rendered. Existing knowledge pages and connector
-- records are Markdown. Owner-uploaded assets use the same knowledge authority
-- while retaining their binary asset representation.
CREATE TYPE hypermedia_document_representation AS ENUM ('markdown','asset');

ALTER TABLE hypermedia_documents
  ADD COLUMN representation hypermedia_document_representation
    NOT NULL DEFAULT 'markdown';

ALTER TABLE hypermedia_documents
  ADD CONSTRAINT hypermedia_documents_authority_representation_check CHECK (
    (authority='source' AND representation='markdown')
    OR authority='knowledge'
  );
