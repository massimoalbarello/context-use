# Steve Jobs — from iPod to iPhone, 2001–2007

A connected historical workspace replacing the random seed. Steve is the owner persona, and pages,
revisions and entity descriptions use his first-person perspective. The focus is **January 9, 2001
through October 17, 2007**: iTunes, iPod, the music store, Windows, mini, shuffle, nano, Motorola ROKR,
video, iPhone and the native SDK commitment. Retail, the Mac’s Intel transition, leadership changes
and the Disney/Pixar relationship explain the work between product launches.

The prose is authored for the simulation, not quoted from Jobs or presented as a recovered diary.
Historical actions and product facts retain their sources. Research records keep the source’s
perspective; invented meetings, messages and checklists are explicitly labeled. There are no
retrieval evaluations, relevance judgments or answer sets yet.

## Run locally

With dependencies installed and Chrome available to browser-harness:

```sh
bun install --frozen-lockfile
bun run dev:isolated:seeded
```

The command registers a real passkey and opens [Hypermedia](http://localhost:5173/hypermedia).
Start at [My work from iPod to iPhone](http://localhost:5173/pages/my-work-from-ipod-to-iphone).
The full corpus loads by default: **one profile, 29 other entities, 49 pages, 12 page updates,
39 records and 27 assets**. `--all` loads the same complete story.

The entities include **11 people and seven organizations**. Steve's profile is automatically typed
as a person; the other types are supplied by the entity fixtures. The 12 products and software
platforms remain untyped because the supported vocabulary has no matching type.

The seeded isolated app treats **17 October 2007** as today for map date navigation and date pickers.
It uses the current map interface; there is no separate timeline view. The override is enabled only
by the seeded development launcher and ignored in production builds. Authentication, ingestion,
page creation and revision timestamps use the real clock. Ordinary development uses the current date.

Stop another server on port 5173 before running this command. The isolated app uses a newly allocated
temporary directory, deleted when the process stops. It does not overwrite an ordinary local database.
Restart for a fresh seed.

## Explore and follow changes

Eight undated notes populate the initial map: my collaborators, touch-interface work, the connection
between hardware and software, partner boundaries, helping customers, working notes, photographs
and commitments. They are relationship or reference lenses. Events and chronological syntheses keep
coverage; the touch-team recollections do not establish a defensible start date, so their uncertainty
is explained rather than assigned a fictional interval.

| Evolving page | Checkpoints |
| --- | --- |
| Taking our music experience beyond the Mac | First iPod → Windows hardware → varied player family → iPod touch |
| Making our store part of the music experience | Mac songs → Windows → television and shorts → EMI’s DRM-free option |
| Bringing our music work into phones | Motorola plan → ROKR → iPhone unveiling → launch arrangements → price, customers and SDK |
| Carrying my Pixar work into Disney | Agreement pending → acquisition closed and board role |
| Giving customers a place to try our products | Opening plan → first weekend with customers |

Each event has its own page. Broader pages link those accounts through Steve’s work and collaborators,
following the [MCP curation guide](../../../apps/backend/src/routes/mcp/pages/hypermedia-curation-guide.md).
The overview reaches every page, entity, record and asset through supported typed links. Targets
exist before their first reference; revisions preserve the earlier checkpoints.

`pages/index.json` orders Markdown snapshots. `asOf` identifies a reconstruction checkpoint, while
`temporalCoverage` dates the subject. Later interviews can establish earlier work; these are not
claims that Steve or an MCP client wrote a page on the checkpoint date. The corpus is pre-curated
for an empty disposable workspace, rather than running an agent’s discovery workflow while seeding.

## Evidence and fiction

There are **34 researched records and five synthetic records**. The invented interactions cover
Tony’s iPod demo handoff, Phil’s Windows rehearsal, a nano/ROKR debrief, Scott’s iPhone rehearsal and
a retail message exchange with Ron. Their wording, dates, attendance and actions are fictional.
Their provider is `synthetic-workspace`, their titles and referring pages are labeled, and they
claim no public source URL. The two checklists use the same explicit fiction boundary.

Most evidence comes from contemporary Apple and Disney announcements. CHM oral histories supply
team recollections, the Disney conference call supplies an actual public conversation, TidBITS
preserves Jobs’s SDK letter, and MacRumors reports and excerpts the early-buyer response.
Record metadata separates publication dates from `attributes.subjectCoverage`; midnight UTC is
only a transport convention for a known publication day. Unverified publication dates are omitted.

The story deliberately preserves distinctions that matter when retrieving an earlier state:

- The 2001 iTunes application predates the 2003 store; 2002 Windows iPods used Musicmatch.
- Mini’s initial April international target differs from the revised July 24 plan.
- Motorola’s first-half 2005 target differs from September’s ROKR release. The sources do not
  establish that ROKR’s reception caused the iPhone project.
- The Pixar agreement and closing are separate, as are Steve’s former CEO and new board roles.
- January’s iPhone unveiling, June’s retail opening, and September’s price change are separate.
- The millionth iPhone sold September 9; the announcement was published September 10.
- June’s web-application offer differs from October’s native SDK promise for February 2008.
  The seed ends at the promise, without claiming the SDK has shipped.
- iTunes Plus begins with EMI; the whole catalog is not suddenly DRM-free.

After registration, the loader creates `/api/syncs` from `syncs/steve-jobs-research.json` using the
owner's session. It delivers records to `/api/records/batch` through the shared request helper using
the temporary sync API key, without session cookies, then revokes the key. The loader resolves
assigned record IDs from authenticated output and substitutes fixture `context-use://record/<id>`
links before submitting pages. References and backlinks use the native record support introduced in
[#66](https://github.com/massimoalbarello/context-use/pull/66).

## Assets

The 23 bundled images give **22 of the 30 entities** an image: all 11 people, seven devices and four
companies. Alongside Steve presenting iPhone, they include collaborator portraits, the original
mini, nano, shuffle, touch and ROKR E1, Apple and Intel marks, and Disney and Pixar campus photographs.

Later portraits and campus photographs are identity references, not evidence of events within the
story. Each image's [credit](assets/historical-asset-credits.txt) and [metadata](assets/index.json)
identify its source, creator, license and date caveats. New images use small Commons thumbnails;
the two company marks use Commons PNG renderings. No photo is represented as taken by Steve.

The other assets are two fictional demo checklists, a sourced commitment ledger separating targets
from results, and the credits file. The CHM source page provides the original interview video.
All uploaded assets are bundled; running the seed requires no media downloads.

## Research sources

Consulted September 11–12, 2026. The records carry claim-level source URLs and date notes. Later
recollections are labeled and used only for the selected work. The complete source index follows.

- [iTunes turns the Mac into a music library](https://www.apple.com/newsroom/2001/01/09Apple-Introduces-iTunes-Worlds-Best-and-Easiest-To-Use-Jukebox-Software/) — 2001-01-09.

- [First physical stores and 25-store plan](https://www.apple.com/newsroom/2001/05/15Apple-to-Open-25-Retail-Stores-in-2001/) — 2001-05-15.

- [First stores opening-weekend results](https://www.apple.com/newsroom/2001/05/21Apple-Retail-Stores-Welcome-Over-7700-People-in-First-Two-Days/) — 2001-05-21.

- [Original iPod announcement and planned availability](https://www.apple.com/newsroom/2001/10/23Apple-Presents-iPod/) — 2001-10-23.

- [Rubinstein recalls the first iPod team](https://archive.computerhistory.org/resources/access/text/2020/02/102717908-05-01-acc.pdf) — undated retrospective/reference.

- [Fadell on joining Apple in 2001](https://computerhistory.org/blog/computing-for-the-whole-world-a-conversation-with-ipod-iphone-inventor-tony-fadell/) — undated retrospective/reference.

- [iPod expands to Windows](https://www.apple.com/newsroom/2002/07/17Apple-Unveils-New-iPods/) — 2002-07-17.

- [Music Store opens on the Mac](https://www.apple.com/newsroom/2003/04/28Apple-Launches-the-iTunes-Music-Store/) — 2003-04-28.

- [iTunes arrives on Windows](https://www.apple.com/newsroom/2003/10/16Apple-Launches-iTunes-for-Windows/) — 2003-10-16.

- [iPod mini announcement and original schedule](https://www.apple.com/newsroom/2004/01/06Apple-Introduces-iPod-mini/) — 2004-01-06.

- [Revised international iPod mini availability](https://www.apple.com/uk/newsroom/2004/07/07Apple-iPod-mini-International-Availability-Set-for-July-24/) — 2004-07-07.

- [Motorola and Apple announce mobile iTunes partnership](https://www.apple.com/uk/newsroom/2004/07/26Motorola-and-Apple-Bring-iTunes-Music-Player-to-Motorolas-Next-Generation-Mobile-Phones/) — 2004-07-26.

- [Flash storage and AutoFill in iPod shuffle](https://www.apple.com/newsroom/2005/01/11Apple-Introduces-iPod-shuffle/) — 2005-01-11.

- [Mac Intel transition announced](https://www.apple.com/newsroom/2005/06/06Apple-to-Use-Intel-Microprocessors-Beginning-in-2006/) — 2005-06-06.

- [iPod nano announcement](https://www.apple.com/newsroom/2005/09/07Apple-Introduces-iPod-nano/) — 2005-09-07.

- [Motorola ROKR launches with iTunes](https://www.apple.com/newsroom/2005/09/07Apple-Motorola-Cingular-Launch-Worlds-First-Mobile-Phone-with-iTunes/) — 2005-09-07.

- [Video comes to iPod hardware](https://www.apple.com/newsroom/2005/10/12Apple-Unveils-the-New-iPod/) — 2005-10-12.

- [Disney television and Pixar shorts arrive in iTunes](https://www.apple.com/newsroom/2005/10/12Apple-Announces-iTunes-6-With-2-000-Music-Videos-Pixar-Short-Films-Hit-TV-Shows/) — 2005-10-12.

- [Cook promotion and iPod succession plan](https://www.apple.com/newsroom/2005/10/14Tim-Cook-Named-COO-of-Apple/) — 2005-10-14.

- [Disney agrees to acquire Pixar](https://thewaltdisneycompany.com/press-releases/disney-to-acquire-pixar/) — 2006-01-24.

- [Jobs and Iger discuss Pixar’s alternatives](https://thewaltdisneycompany.com/app/uploads/ir/2006/events/pixar-2006-0124-transcript.pdf) — 2006-01-24.

- [Disney completes Pixar acquisition](https://thewaltdisneycompany.com/press-releases/disney-completes-pixar-acquisition/) — 2006-05-05.

- [Forstall and the original iPhone engineers look back](https://computerhistory.org/blog/creating-magic-a-conversation-with-original-iphone-engineers-software-team-lead-scott-forstall/) — 2017-06-22.

- [iPhone announcement and US launch plan](https://www.apple.com/newsroom/2007/01/09Apple-Reinvents-the-Phone-with-iPhone/) — 2007-01-09.

- [One hundred million iPods sold](https://www.apple.com/newsroom/2007/04/09100-Million-iPods-Sold/) — 2007-04-09.

- [EMI catalog launches in iTunes Plus](https://www.apple.com/newsroom/2007/05/30Apple-Launches-iTunes-Plus/) — 2007-05-30.

- [The initial third-party iPhone application offer](https://www.apple.com/newsroom/2007/06/11iPhone-to-Support-Third-Party-Web-2-0-Applications/) — 2007-06-11.

- [iPhone specifications revised before sale](https://www.apple.com/newsroom/2007/06/18iPhone-Delivers-Up-to-Eight-Hours-of-Talk-Time/) — 2007-06-18.

- [iPhone retail launch arrangements](https://www.apple.com/newsroom/2007/06/28iPhone-Premieres-This-Friday-Night-at-Apple-Retail-Stores/) — 2007-06-28.

- [iPhone price reduction](https://www.apple.com/newsroom/2007/09/05Apple-Sets-iPhone-Price-at-399-for-this-Holiday-Season/) — 2007-09-05.

- [iPod touch brings multi-touch and Wi-Fi](https://www.apple.com/newsroom/2007/09/05Apple-Unveils-iPod-touch/) — 2007-09-05.

- [Jobs responds to early iPhone customers](https://www.macrumors.com/2007/09/06/steve-jobs-open-letter-to-iphone-owners/) — 2007-09-06.

- [First million iPhones reported](https://www.apple.com/newsroom/2007/09/10Apple-Sells-One-Millionth-iPhone/) — 2007-09-10.

- [Jobs commits to a native iPhone SDK](https://tidbits.com/2007/10/17/steve-jobss-iphone-sdk-letter/) — 2007-10-17.
