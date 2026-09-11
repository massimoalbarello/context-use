# Steve Jobs, 2000–2001

A connected historical demo replacing the former random Northstar fixtures. Steve Jobs is the
workspace owner persona. The chapter follows his permanent Apple CEO appointment, the Mac OS X
transition, the Cube, digital-media software, the first Apple stores, iPod and Pixar’s Monsters, Inc.
The two-year focus keeps the people and projects closely connected while retaining commercial
setbacks, revised expectations and parallel responsibilities.

## Run locally

From the repository root, with dependencies installed and Chrome available to browser-harness:

```sh
bun install --frozen-lockfile
bun run dev:isolated:seeded
```

The command registers a real passkey using the existing virtual authenticator and opens
[the local workspace](http://localhost:5173/hypermedia). Start reading at
[Steve Jobs — 2000 to 2001](http://localhost:5173/pages/steve-jobs-2000-to-2001).

The complete story loads by default: **one profile, 23 other entities, 32 pages, eight page updates,
29 records and six assets**. The existing `--all` option loads the same complete corpus; there is
no separate set of filler resources. Stop another development server before starting this one.
The data lives in a newly allocated temporary directory and is deleted when the isolated process
stops. It does not overwrite an ordinary local database. Restart the command for a fresh copy.

## Follow the changes

| Page | Revision sequence |
| --- | --- |
| Moving the Mac to OS X | January 2000 preview → September beta → March 2001 shipping → September 10.1 |
| The Cube bet | July 2000 launch → February 2001 CD-RW configuration → July suspension |
| The Mac as a digital hub | January music library → October portable player |
| Learning to sell the whole experience | May 15 plan → first weekend results reported May 21 |
| Two CEO roles | Permanent Apple appointment → Apple and Pixar chapter synthesis |

Each event keeps its own page and coverage. The broader pages connect events through Steve’s work
and collaborators, following the [MCP curation guide](../../../apps/backend/src/routes/mcp/pages/hypermedia-curation-guide.md).
The overview reaches every page, entity, record and asset. All relationships use supported typed
links, with targets created before their first reference.

`pages/index.json` is an ordered sequence of Markdown snapshots, including revisions. `asOf` orders
the narrative checkpoints; `temporalCoverage` dates the subject. Retrospective research can establish
an earlier event, so these are reconstructed states, not claims that an MCP client or Steve wrote a
page on the indicated day. Database creation, revision and ingestion timestamps are the actual local
seed time, never backdated. No retrieval evaluations, relevance labels or answer sets are included.

## Evidence and fiction

There are 25 researched records with original paraphrases and source URLs, plus four explicitly
synthetic records: beta triage, a retail rehearsal, an iPod demo handoff and a Pixar conversation.
The synthetic provider is `synthetic-workspace`; its records, referring pages and checklist label
the invented wording, dates and attendance. No fabricated record claims a public source URL.

The record index retains provider, kind, participants, source publication date where established,
and `attributes.subjectCoverage`. Midnight UTC represents a known publication *day*, not an observed
publication time. Modern catalog pages and oral histories without verified publication dates omit
source timestamps; interview dates and the historical subject remain separate. In particular:

- Summer 2000 was the initial OS X commercial-release expectation; March 24, 2001 was shipping.
- Factory preinstallation in May 2001 still defaulted to booting Mac OS 9.1.
- The Cube’s DVD launch model and later CD-RW configuration are distinct.
- Store results cover both stores over May 19–20, reported May 21; 25 stores was a rollout target.
- October 23 was the iPod announcement; November 10 was the announced availability date.
- Fiscal Q1 2001 ended in December 2000; the October 2001 reported quarter ended before iPod.
- Pixar’s current timeline only locates the Emeryville move within its 2000–2001 grouping.

Records enter through `/api/syncs` and `/api/records/batch`, after owner registration. The temporary
sync key stays inside the browser and is revoked immediately after delivery; its records remain
readable. The loader resolves record IDs from the authenticated record listing. Fixtures use
`context-use://record/<fixture-id>` links; the loader substitutes the server-assigned readable ID
before submitting each page. These native references appear in page References and record
Referenced by views, using the support introduced in [#66](https://github.com/massimoalbarello/context-use/pull/66).
Public source URLs remain inside each record.

## Assets

Three licensed photographs are bundled, assigned as entity images and linked from the reference
page. They are later illustrations, not photographs of the seeded events: a June 2010 Jobs portrait,
a May 2005 Cube photograph and an iPod cutout uploaded in 2006 with unconfirmed capture date.
[Asset credits](assets/historical-asset-credits.txt) and [the manifest](assets/index.json) retain
creators, source pages, licenses and date caveats. The other assets are a sourced quarterly-results
CSV, an explicitly invented demo checklist and the credits file itself. The official Disney page
linked from the film page provides its trailer and production videos. No media download is needed
when running the seed.

## Check fixtures

```sh
python3 scripts/seeds/isolated-development/test_fixtures.py
```

These checks protect reference ordering, reachability, fixture completeness, fiction labels and
bundled-media provenance. The actual seed also verifies server-assigned IDs, detected image types,
record import completeness and revision increments. Exercise the isolated app for application-level
validation after changing fixtures or the loader.

## Research sources

The records contain the claim-level source links. This index makes the research reviewable outside
the running app. Sources were consulted on September 11, 2026; later retrospectives are labeled as
such and are used only for the selected period.

- [Jobs drops the interim title](https://money.cnn.com/2000/01/05/deals/apple/) — 2000-01-05.
- [Mac OS X preview and original schedule](https://www.apple.com/newsroom/2000/01/05Apple-Unveils-Mac-OS-X/) — 2000-01-05.
- [Cube and iMovie 2 desktop announcement](https://www.apple.com/newsroom/2000/07/19Apple-Unveils-Entirely-New-Desktop-Line-Including-the-Revolutionary-Power-Mac-G4-Cube/) — 2000-07-19.
- [Mac OS X public beta opens to users](https://www.apple.com/newsroom/2000/09/13Apple-Releases-Mac-OS-X-Public-Beta/) — 2000-09-13.
- [iTunes turns the Mac into a music library](https://www.apple.com/newsroom/2001/01/09Apple-Introduces-iTunes-Worlds-Best-and-Easiest-To-Use-Jukebox-Software/) — 2001-01-09.
- [Mac OS X receives a March shipping date](https://www.apple.com/newsroom/2001/01/09Apples-Mac-OS-X-to-Ship-on-March-24/) — 2001-01-09.
- [Fiscal Q1 2001 loss and inventory reset](https://www.apple.com/newsroom/2001/01/17Apple-Reports-First-Quarter-Results/) — 2001-01-17.
- [SuperDrive systems begin shipping](https://www.apple.com/newsroom/2001/02/19Apple-Ships-Industrys-First-SuperDrive/) — 2001-02-19.
- [Cube gains CD-RW and iTunes](https://www.apple.com/newsroom/2001/02/22Apple-Introduces-New-Power-Mac-G4-Cube-With-CD-RW-iTunes/) — 2001-02-22.
- [Fiscal Q2 2001 return to profit](https://www.apple.com/newsroom/2001/04/18Apple-Reports-Second-Quarter-Profit-of-43-Million/) — 2001-04-18.
- [First physical stores and 25-store plan](https://www.apple.com/newsroom/2001/05/15Apple-to-Open-25-Retail-Stores-in-2001/) — 2001-05-15.
- [First stores opening-weekend results](https://www.apple.com/newsroom/2001/05/21Apple-Retail-Stores-Welcome-Over-7700-People-in-First-Two-Days/) — 2001-05-21.
- [Mac OS X preinstalled beside Mac OS 9](https://www.apple.com/newsroom/2001/05/21Apple-to-Pre-Install-Mac-OS-X-Ahead-of-Schedule/) — 2001-05-21.
- [Cube production suspended indefinitely](https://www.apple.com/newsroom/2001/07/03Apple-Puts-Power-Mac-G4-Cube-on-Ice/) — 2001-07-03.
- [Mac OS X 10.1 availability and improvements](https://www.apple.com/newsroom/2001/09/25First-Major-Upgrade-to-Mac-OS-X-Hits-Stores-This-Weekend/) — 2001-09-25.
- [Mac OS X native application count](https://www.apple.com/newsroom/2001/09/25More-than-1-400-Third-Party-Applications-Now-Available-for-Mac-OS-X-v10-1/) — 2001-09-25.
- [Fiscal Q4 closes before iPod announcement](https://www.apple.com/newsroom/2001/10/17Apple-Reports-Fourth-Quarter-Profit-of-66-Million/) — 2001-10-17.
- [Original iPod announcement and planned availability](https://www.apple.com/newsroom/2001/10/23Apple-Presents-iPod/) — 2001-10-23.
- [Pixar moves and releases its fourth feature](https://www.pixar.com/our-story) — undated retrospective/reference.
- [Monsters Inc US release and creative credits](https://movies.disney.com/monsters-inc) — undated retrospective/reference.
- [Monsters Inc character and world development](https://www.pixar.com/monsters-inc) — undated retrospective/reference.
- [Rubinstein recalls the first iPod team](https://archive.computerhistory.org/resources/access/text/2020/02/102717908-05-01-acc.pdf) — undated retrospective/reference.
- [Fadell on joining Apple in 2001](https://computerhistory.org/blog/computing-for-the-whole-world-a-conversation-with-ipod-iphone-inventor-tony-fadell/) — undated retrospective/reference.
- [Tevanian software leadership retrospective](https://www.apple.com/newsroom/2003/07/08Avie-Tevanian-Named-Chief-Software-Technology-Officer-of-Apple/) — 2003-07-08.
- [Ron Johnson recalls creating Apple retail](https://books.apple.com/gb/book/shop-different/id6753891179) — undated retrospective/reference.
